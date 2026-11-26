"""The computer's own account can install an agent that carries skills.

It was refused (`needs_own_account`), because the tool looks for skills in its
settings folder and for this account that folder is the person's own. A
computer with no added account, which is every computer on its first day, then
had no way to get Hermes at all. The skills go into a plugin folder of this
app's instead, and only a chat that runs an agent is handed it.
"""
import json

from divan import agents
from divan.providers.base import ProviderConfig
from divan.providers.claude import ClaudeProvider

SRC = agents._BY_ID["hermes"]


def _own_account(monkeypatch, tmp_path):
    monkeypatch.setattr(agents, "DEFAULT_AGENTS", tmp_path / "default" / "agents")
    monkeypatch.setattr(agents, "DEFAULT_PLUGIN", tmp_path / "default" / "plugin")
    monkeypatch.setattr(agents, "machine_home", lambda provider: tmp_path / "machine")
    monkeypatch.setattr(agents, "_tree", lambda repo, branch="main": [
        "hermes-CCC-master/skills/arxiv/SKILL.md", "hermes-CCC-master/skills/docker/SKILL.md"])
    monkeypatch.setattr(agents, "_get", lambda url, **k: b"---\nname: x\ndescription: y\n---\nbody\n")


def _options(tmp_path, **kw):
    async def emit(*a, **k):
        pass
    cfg = ProviderConfig(model="sonnet", effort=None, perm_mode="bypass", cwd=str(tmp_path),
                         session_id=None, **kw)
    return ClaudeProvider(cfg, emit, None)._options()


def test_it_installs_without_touching_the_persons_own_settings(monkeypatch, tmp_path):
    _own_account(monkeypatch, tmp_path)
    r = agents.install_bundle(SRC, None)
    plugin = tmp_path / "default" / "plugin"
    assert r["skills"] == 2 and not r["missing"]
    assert (plugin / "skills" / "arxiv" / "SKILL.md").is_file()
    assert json.loads((plugin / ".claude-plugin" / "plugin.json").read_text())["name"] == agents.PLUGIN_NAME
    assert not (tmp_path / "machine").exists()
    found = agents.find("hermes", None)
    assert found and found["name"] == "hermes"
    # the list names each skill the way the tool will, plugin first
    assert "divan:arxiv, divan:docker" in agents.body(found["path"])


def test_an_account_of_its_own_still_lists_plain_names(monkeypatch, tmp_path):
    _own_account(monkeypatch, tmp_path)
    home = tmp_path / "acc"
    home.mkdir()
    agents.install_bundle(SRC, str(home))
    assert "arxiv, docker" in agents.body(str(home / "agents" / "hermes.md"))
    assert agents.default_plugin() is None


def test_only_an_agents_chat_on_that_account_is_handed_the_plugin(monkeypatch, tmp_path):
    _own_account(monkeypatch, tmp_path)
    assert agents.default_plugin() is None
    assert not _options(tmp_path, agent_prompt="You are Hermes").plugins
    agents.install_bundle(SRC, None)
    plugin = str(tmp_path / "default" / "plugin")
    assert _options(tmp_path, agent_prompt="You are Hermes").plugins == [{"type": "local", "path": plugin}]
    assert not _options(tmp_path).plugins
    assert not _options(tmp_path, agent_prompt="You are Hermes", account_home=str(tmp_path / "acc")).plugins
