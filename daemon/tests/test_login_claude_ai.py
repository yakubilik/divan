"""Claude Code 2.1.33x prints its sign-in link on claude.ai, which was not a
login host, so the panel never showed a link and every subscription sign-in
timed out after 15 minutes (25 Nov 2026). A setup-token copied from a terminal
also arrived wrapped over two lines and was refused."""
import asyncio

from divan import accounts as A


def _session():
    events = []

    async def emit(kind, data):
        events.append((kind, data))

    acc = A.Account(id="t", provider="claude", label="t")
    return A.LoginSession(acc, emit, method="subscription"), events


def test_claude_ai_login_link_reaches_the_phone():
    s, events = _session()
    s._feed(b"Opening browser to sign in\xe2\x80\xa6\r\n"
            b"If the browser didn't open, visit:\r\n"
            b"https://claude.ai/oauth/authorize?code=true&client_id=x\r\n"
            b"Paste code here if prompted > ")
    asyncio.run(s._scan())
    assert s.url == "https://claude.ai/oauth/authorize?code=true&client_id=x"
    assert events and events[0][0] == "account.login.prompt"


def test_unknown_host_is_still_not_shown():
    s, events = _session()
    s._feed(b"visit: https://claude.ai.evil.example/oauth/authorize?x=1\r\n")
    asyncio.run(s._scan())
    assert s.url is None and not events


def test_a_login_host_cannot_be_borrowed():
    # each of these opens evil.example in a browser, whatever name follows the @
    for url in ("https://evil.example?@claude.ai/oauth/authorize",
                "https://evil.example#@claude.ai/",
                "https://evil.example\\@claude.ai/x",
                "https://claude.ai@evil.example/",
                "https://claude.ai.evil.example/",
                "https://user@claude.ai/oauth/authorize",
                "https://claude.ai:8443/oauth/authorize",
                "http://claude.ai/oauth/authorize"):
        assert A.login_host(url) is None, url
        s, events = _session()
        s._feed(f"visit: {url}\r\n".encode())
        asyncio.run(s._scan())
        assert s.url is None and not events, url


def test_the_host_sent_to_the_phone_is_the_parsed_one():
    assert A.login_host("https://CLAUDE.AI/oauth/authorize?x=1") == "claude.ai"
    s, events = _session()
    s._feed(b"https://platform.claude.com/oauth/authorize?code=true\r\n")
    asyncio.run(s._scan())
    assert events[0][1]["url_host"] == "platform.claude.com"


def test_a_key_wrapped_over_two_lines_is_joined():
    # kept short, so the secret scanner does not take the sample for a real key
    assert A.clean_key(" sk-ant-oat01-ab_c\n  d-e \n") == "sk-ant-oat01-ab_cd-e"
    assert A.clean_key(None) == ""
    assert A.is_oauth_token(A.clean_key("sk-ant-oat01-x\r\n y"))
