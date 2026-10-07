#!/usr/bin/env python3
"""The voice call speaks as Hermes when Hermes is there. No model turns.

    python scripts/test_call.py

What the call says is decided before the model is asked anything: which manner
goes into the system prompt, what the profile and the snapshot hold, which
filters run over the answer, and what a hand-off starts. All of that is checked
here against a fake account home, a fake queue and a temporary chat database.
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
import sys
import tempfile
import time
import types
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="rac-call-"))
os.environ["USTABASI_STATE_DIR"] = str(tmp / "nowhere")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from claude_agent_sdk import (                                    # noqa: E402
    AssistantMessage, RateLimitEvent, RateLimitInfo, ResultMessage, TextBlock)

from remote_ai_chat import call                                  # noqa: E402
from remote_ai_chat import server as server_mod                  # noqa: E402
from remote_ai_chat import ustabasi as u                         # noqa: E402
from remote_ai_chat.accounts import Account                      # noqa: E402
from remote_ai_chat.db import DB                                 # noqa: E402
from remote_ai_chat.pool import Pool, Settings                   # noqa: E402
from remote_ai_chat.security import PathPolicy                   # noqa: E402
from remote_ai_chat.server import Server                         # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


# Never the person's own files.
call.MANNER_FILE = tmp / "concierge.md"
call.PROFILE_FILE = tmp / "caller.md"

plain_home = tmp / "plain"
(plain_home / "agents").mkdir(parents=True)
hermes_home = tmp / "hermes"
(hermes_home / "agents").mkdir(parents=True)
(hermes_home / "agents" / "hermes.md").write_text("---\nname: hermes\n---\n\nYou are Hermes.\n")

# ── 1 · the manner ───────────────────────────────────────────────────────────
print("persona")
hermes = call.hermes_installed(str(hermes_home))
check(hermes and not call.hermes_installed(str(plain_home)),
      "hermes.md under the account home is what makes it Hermes")
old = call.system_prompt(call.hermes_installed(str(plain_home)))
check(old == f"{call.SYSTEM}\n\n{call.MANNER_DEFAULT}",
      "without Hermes the prompt is the rules and the butler, as before")
new = call.system_prompt(hermes)
check(call.MANNER_HERMES in new and call.MANNER_DEFAULT not in new,
      "with Hermes the manner is Hermes's")
said = [line for line in new.splitlines()
        if ("sir" in line.split() or "sir." in line or "sir\"" in line or "efendim" in line)
        and "No \"sir\"" not in line]
check(not said, "and nothing in it tells the model to say sir or efendim", repr(said))

call.MANNER_FILE.write_text("Manner: speak like a pirate.\n")
check(call.system_prompt(False).endswith("Manner: speak like a pirate.")
      and call.system_prompt(True).endswith("Manner: speak like a pirate."),
      "concierge.md wins in both modes")
call.MANNER_FILE.unlink()

# ── 2 · the filters ──────────────────────────────────────────────────────────
print("filters")
tr = "Kanka, iki oturum çalışıyor, biri onay bekliyor."
check(call.speakable(tr, hermes=True) == tr, "Hermes keeps the caller's 'kanka'")
check(call.speakable("Two sessions are running.", hermes=True) == "Two sessions are running.",
      "and adds no honorific")
check(call.speakable(tr, hermes=False) == call.fix_address(call.strip_slang(tr))
      and "anka" not in call.speakable(tr, hermes=False), "the house still strips slang")
check(call.speakable("No, efendim.", hermes=False) == "No, sir.",
      "and still matches its honorific to the language")

# ── 3 · the profile ──────────────────────────────────────────────────────────
print("profile")
mem = hermes_home / "projects" / "-Users-x-projects-a" / "memory"
mem.mkdir(parents=True)
(mem / "who-is-yakup.md").write_text(
    "---\nname: who-is-yakup\ndescription: d\n---\n\nYakup, a developer. " + "x" * 2000)
(mem / "yakup-working-style.md").write_text("---\nname: s\n---\n\nTerse, Turkish.\n")
(mem / "secrets-handling.md").write_text("never read this")
twin = hermes_home / "projects" / "-Users-x-projects-b" / "memory"
twin.mkdir(parents=True)
(twin / "who-is-yakup.md").write_text("---\nname: who-is-yakup\n---\n\nYakup, a developer.\n")
block = call.profile(str(hermes_home))
check(0 < len(block) <= call.PROFILE_CHARS, "a profile block of at most 1500 characters", str(len(block)))
check("Yakup, a developer." in block and "name:" not in block and "---" not in block,
      "read from who-is, without frontmatter", block[:200])
check("never read this" not in block, "and nothing else out of memory")
(mem / "who-is-yakup.md").write_text("---\nname: w\n---\n\nYakup, a developer.\n")
block = call.profile(str(hermes_home))
check("Terse, Turkish." in block and block.count("Yakup, a developer.") == 1,
      "working-style is in it too, and a file shared across projects once", block)
check(call.profile(str(plain_home)) == "" and call.profile(str(tmp / "missing")) == "",
      "an empty or missing memory folder gives no profile and no error")


async def options_prompt(home: Path) -> str:
    c = call.Concierge(lambda: ("", []), lambda: (str(home), {}), {"send": None})
    return c._options().system_prompt, c._options()


prompt, opts = asyncio.run(options_prompt(hermes_home))
check(block in prompt and call.MANNER_HERMES in prompt,
      "the session's system prompt carries the profile and the Hermes manner")
check(len(prompt) - len(call.system_prompt(False)) <= 2500,
      "and grows by at most ~2500 characters", str(len(prompt) - len(call.system_prompt(False))))
check(opts.model == call.MODEL_ALIASES["sonnet"] and call.MODEL == "sonnet"
      and opts.tools == [] and opts.setting_sources is None,
      "the general call's session is Sonnet, no built-in tools, no settings", str(opts.model))
prompt, _ = asyncio.run(options_prompt(plain_home))
check(prompt == call.system_prompt(False), "a home with neither is today's prompt")

# ── 4 · the queue ────────────────────────────────────────────────────────────
print("queue")
db = DB(tmp / "chats.sqlite")
sessions = types.SimpleNamespace(peek=lambda _cid: None)
text, _ = call.snapshot(db, sessions, "mac", None)
check("TICKET QUEUE" not in text, "no queue, no section")

state = tmp / "state"
state.mkdir()
conn = sqlite3.connect(state / "ustabasi.db")
conn.executescript("""
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY, slug TEXT, title TEXT, card TEXT, repo TEXT,
  base_branch TEXT, status TEXT, stage TEXT, round INTEGER,
  created_at REAL, updated_at REAL, started_at REAL, finished_at REAL,
  worktree TEXT, branch TEXT, notes TEXT, verdict TEXT, escalation TEXT, ask TEXT
);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL,
  kind TEXT, msg TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
""")
NOW = time.time()
rows = [
    (1204, "Aramada Hermes konuşsun", "running", NOW - 1300, ""),
    (1205, "Fix login in /Users/x/projects/app/src/auth.ts", "blocked", NOW - 9000,
     "Which Stripe account, see https://example.com/x?"),
    (1206, "queued one", "queued", None, ""),
    (1207, "queued two", "queued", None, ""),
    (1208, "queued three", "queued", None, ""),
    (1209, "long done", "done", NOW - 90000, ""),
]
for tid, title, status, started, ask in rows:
    conn.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (tid, f"t{tid}", title, "{}", "/Users/x/projects/remote-ai-chat", "main",
                  status, "worker", 1, NOW - 99000, NOW, started, None, None, "b", "[]",
                  None, "", ask))
conn.commit()
conn.close()
u.DB_PATH = state / "ustabasi.db"
queue = u.snapshot(git=False)
text, _ = call.snapshot(db, sessions, "mac", queue)
section = text[text.index("TICKET QUEUE"):].split("\n\n")[0]
print("    " + section.replace("\n", "\n    "))
lines = section.splitlines()
check(len(lines) <= 6, "the section is at most six lines", str(len(lines)))
check(any("Running" in l and "Hermes" in l and "about 20 minutes in" in l for l in lines),
      "the running ticket, with how long")
check(any("Waiting on the user" in l and "Fix login" in l and "Stripe" in l for l in lines),
      "the one waiting on the person, with what it asks")
check(any("3 ticket(s) queued" in l for l in lines), "and how many are queued")
check("/" not in section and "http" not in section and not any(c.isdigit() and len(c) > 3
      for c in section.replace(".", " ").replace(",", " ").split()),
      "no path, no URL, no long id", section)
u.DB_PATH = tmp / "nowhere" / "ustabasi.db"

# ── 5 · the hand-off ─────────────────────────────────────────────────────────
print("hand-off")
root = tmp / "projects"
(root / "focus").mkdir(parents=True)
policy = PathPolicy([str(root)], [])


class Host:
    """Enough of `Server` for `_concierge_actions` and `h_chat_create`."""

    def __init__(self, home: Path):
        self.db = DB(tmp / f"hand-{home.name}.sqlite")
        self.policy = policy
        self.cfg = types.SimpleNamespace(allowed_roots=[str(root)], host_name="mac", demo=False,
                                         refresh_tunnel=lambda: None, person_names=lambda: [],
                                         person_of=lambda _id: None)
        self.accounts = {
            "default-claude": Account(id="default-claude", provider="claude", label="m"),
            "claude-x": Account(id="claude-x", provider="claude", label="x", home=str(home)),
        }
        self._concierge_acct = self.accounts["claude-x"]
        self.sent: list[tuple[str, str]] = []
        host = self

        class S:
            def __init__(self, cid):
                self.cid = cid

            async def send(self, text, _att):
                host.sent.append((self.cid, text))
                return False

        self.sessions = types.SimpleNamespace(get=S)
        for name in ("_concierge_actions", "h_chat_create", "_account", "_owner"):
            setattr(self, name, getattr(Server, name).__get__(self))

    async def broadcast(self, _ev):
        pass


async def hand_off(home: Path) -> dict:
    h = Host(home)
    where = await h._concierge_actions()["start"]("focus", "takvime yarın 10'u ekle")
    chat = h.db.get_chat(h.sent[0][0])
    return {"where": where, "chat": chat, "sent": h.sent}


got = asyncio.run(hand_off(hermes_home))
check(got["where"] == "focus" and got["chat"]["agent_id"] == "user:hermes"
      and got["chat"]["account_id"] == "claude-x",
      "with Hermes installed the new chat is a Hermes chat on that account",
      str({k: got["chat"].get(k) for k in ("agent_id", "account_id")}))
check(got["sent"][0][1] == "takvime yarın 10'u ekle", "and gets the instruction")
got = asyncio.run(hand_off(plain_home))
check(got["chat"]["agent_id"] is None, "without it, a chat with no agent, as before",
      str(got["chat"].get("agent_id")))

# ── 6 · the account ──────────────────────────────────────────────────────────
print("account")
QUESTION = "what is running?"
LIMIT_LINE = "You've hit your limit · resets 3pm"


def full(resets_in: float) -> list[dict]:
    return [{"window": "five_hour", "status": "rejected", "utilization": 1.0,
             "resets_at": time.time() + resets_in, "at": time.time()}]


class Machine:
    """Enough of `Server` for the call to choose, and change, its account."""

    def __init__(self, limits: dict[str, list[dict]], signed_out: tuple[str, ...] = ()):
        self.db = DB(tmp / "account.sqlite")
        self.limits = {k: {r["window"]: r for r in rows} for k, rows in limits.items()}
        self.accounts = {
            "default-claude": Account(id="default-claude", provider="claude", label="m"),
            "acct-2": Account(id="acct-2", provider="claude", label="two",
                              home=str(tmp / "a2"), created_at=2),
            "acct-3": Account(id="acct-3", provider="claude", label="three",
                              home=str(tmp / "a3"), created_at=3),
        }
        self.signed_out = signed_out
        self._concierge_acct = None
        self._concierge_skip = {}
        self._sweeps = set()
        self.CONCIERGE_SKIP_S = Server.CONCIERGE_SKIP_S
        self._learn_steps = Server._learn_steps
        for name in ("_account", "_limit_rows", "_remember_limits", "_sweep_later",
                     "_concierge_account", "_concierge_limits", "_concierge_limited"):
            setattr(self, name, getattr(Server, name).__get__(self))
        self.pool = Pool(Settings(), lambda: self.accounts, self._limit_rows)
        self.concierge = call.Concierge(lambda: ("nothing is running", []),
                                        self._concierge_account, {},
                                        on_limits=self._concierge_limits,
                                        on_limited=self._concierge_limited)

    def home(self) -> str | None:
        return self._concierge_account()[0]


class FakeClient:
    """A CLI session that refuses on the accounts in `spent` and answers on the
    rest. Which account it is shows in the config dir it was started with."""
    spent: set[str | None] = set()
    asked: list[tuple[str | None, str]] = []

    def __init__(self, options):
        self.home = options.env.get("CLAUDE_CONFIG_DIR")

    async def connect(self):
        pass

    async def disconnect(self):
        pass

    async def query(self, prompt):
        FakeClient.asked.append((self.home, prompt))

    async def receive_response(self):
        if self.home in FakeClient.spent:
            yield RateLimitEvent(rate_limit_info=RateLimitInfo(
                status="rejected", rate_limit_type="five_hour", utilization=1.0,
                resets_at=int(time.time()) + 7200), uuid="u", session_id="s")
            yield AssistantMessage(content=[TextBlock(text=LIMIT_LINE)], model="m")
            yield ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1,
                                is_error=True, num_turns=1, session_id="s", result=LIMIT_LINE)
            return
        yield AssistantMessage(content=[TextBlock(text="Nothing is running.")], model="m")
        yield ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1,
                            is_error=False, num_turns=1, session_id="s")


def signed_in(a):
    a.logged_in = a.id not in machine.signed_out
    return a


real_refresh, real_client = server_mod.acct.refresh, call.ClaudeSDKClient
server_mod.acct.refresh, call.ClaudeSDKClient = signed_in, FakeClient
os.environ.pop("CLAUDE_CONFIG_DIR", None)
try:
    machine = Machine({})
    check(machine.home() is None and machine._concierge_acct.id == "default-claude",
          "with nothing limited the call is the machine's own login, as before")

    machine = Machine({"default-claude": full(3600)})
    check(machine.home() == str(tmp / "a2") and machine._concierge_acct.id == "acct-2",
          "a machine login the pool calls spent sends the call to the next free account",
          str(machine._concierge_acct.id))

    machine = Machine({"default-claude": full(3600)}, signed_out=("acct-2",))
    check(machine.home() == str(tmp / "a3"), "and past one that is not signed in")

    machine = Machine({}, signed_out=("default-claude",))
    check(machine.home() == str(tmp / "a2"), "no machine login still falls to another account")

    # A turn refused mid-call: the pool had nothing on the account beforehand.
    machine = Machine({})
    FakeClient.spent, FakeClient.asked = {None}, []
    got = asyncio.run(machine.concierge.ask(QUESTION, "en-US"))
    homes = [h for h, _ in FakeClient.asked]
    check(got["text"] == "Nothing is running." and "limit" not in got["text"],
          "a turn refused for the usage limit comes back as one answer, not the refusal",
          got["text"])
    check(homes == [None, str(tmp / "a2")]
          and all(QUESTION in prompt for _, prompt in FakeClient.asked),
          "the same question, asked again on the next free account", str(homes))
    check(machine.pool.state("default-claude", "claude").blocked,
          "and the refusal's limit reading reached the pool")

    for lang, words in (("tr-TR", "Hiçbir hesapta"), ("en-US", "No account"), (None, "No account")):
        machine = Machine({"default-claude": full(3 * 3600), "acct-2": full(1800),
                           "acct-3": full(2 * 3600)})
        FakeClient.spent, FakeClient.asked = set(), []
        got = asyncio.run(machine.concierge.ask(QUESTION, lang))
        clock = time.strftime("%H:%M", time.localtime(time.time() + 1800))
        check(got["text"].startswith(words) and clock in got["text"]
              and len(call._SENTENCE.split(got["text"])) == 1 and not FakeClient.asked,
              f"every account spent ({lang}): one sentence with the earliest reset, no model turn",
              f"{got['text']!r} asked={len(FakeClient.asked)}")
        print("    " + got["text"])
finally:
    server_mod.acct.refresh, call.ClaudeSDKClient = real_refresh, real_client

print()
if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all passed")
