"""A chat's first message picks the agent whose `route:` pattern it matches."""
from divan import agents
from langpack import tr_data


def _agent(home, name, route=None):
    d = home / "agents"
    d.mkdir(parents=True, exist_ok=True)
    head = f"---\nname: {name}\n" + (f"route: {route}\n" if route else "") + "---\nprompt\n"
    (d / f"{name}.md").write_text(head, encoding="utf-8")


def test_first_message_goes_to_the_agent_it_is_about(tmp_path):
    _agent(tmp_path, "hermes")
    _agent(tmp_path, "coach", r"(?<!\w)(run(?!time)\w*|pulse|sleep\w*)")
    assert agents.route("Analyse the pulse of my last run", str(tmp_path))["name"] == "coach"
    assert agents.route("SLEEPING badly", str(tmp_path))["name"] == "coach"
    assert agents.route("why is the runtime wrong", str(tmp_path)) is None
    assert agents.route("chat list", str(tmp_path)) is None


def test_turkish_messages_are_lowered_the_turkish_way(tmp_path):
    tr = tr_data("test_agent_route")
    _agent(tmp_path, "coach", tr["pattern"])
    for text in tr["match"]:
        assert agents.route(text, str(tmp_path))["name"] == "coach", text
    for text in tr["no_match"]:
        assert agents.route(text, str(tmp_path)) is None, text


def test_a_broken_pattern_is_skipped_not_fatal(tmp_path):
    _agent(tmp_path, "bad", "(unclosed")
    assert agents.route("anything", str(tmp_path)) is None
