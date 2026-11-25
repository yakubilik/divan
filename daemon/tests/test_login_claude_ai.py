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


def test_a_key_wrapped_over_two_lines_is_joined():
    assert A.clean_key(" sk-ant-oat01-AAAA_bbbb\n  CCCC-dd \n") == "sk-ant-oat01-AAAA_bbbbCCCC-dd"
    assert A.clean_key(None) == ""
    assert A.is_oauth_token(A.clean_key("sk-ant-oat01-x\r\n y"))
