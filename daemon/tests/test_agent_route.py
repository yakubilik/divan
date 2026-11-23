"""A chat's first message picks the agent whose `route:` pattern it matches."""
from divan import agents


def _agent(home, name, route=None):
    d = home / "agents"
    d.mkdir(parents=True, exist_ok=True)
    head = f"---\nname: {name}\n" + (f"route: {route}\n" if route else "") + "---\nprompt\n"
    (d / f"{name}.md").write_text(head, encoding="utf-8")


def test_first_message_goes_to_the_agent_it_is_about(tmp_path):
    _agent(tmp_path, "hermes")
    _agent(tmp_path, "coach", r"(?<![\wçğıöşü])(koş(u(?!l)|tu)\w*|nab[ıi]z|uyku\w*)")
    assert agents.route("Son koşumun nabız analizi", str(tmp_path))["name"] == "coach"
    assert agents.route("UYKUM bozuk", str(tmp_path))["name"] == "coach"
    assert agents.route("bu koşul neden yanlış", str(tmp_path)) is None
    assert agents.route("chat listesi", str(tmp_path)) is None


def test_a_broken_pattern_is_skipped_not_fatal(tmp_path):
    _agent(tmp_path, "bad", "(unclosed")
    assert agents.route("anything", str(tmp_path)) is None
