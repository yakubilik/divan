"""The Plane gateway: what it lets through, and what it changes on the way."""
import asyncio

from divan import plane_gateway as gw


KEY = b"k" * 32


def test_a_pass_holds_until_it_expires_and_only_with_its_key():
    p = gw.mint(KEY, now=1000)
    assert gw.valid(KEY, p, now=1001)
    assert not gw.valid(KEY, p, now=1000 + gw.PASS_TTL_S + 1)
    assert not gw.valid(b"x" * 32, p, now=1001)
    exp, who, sig = p.split(".")
    assert not gw.valid(KEY, f"{int(exp) + 999}.{who}.{sig}", now=1001)
    assert not gw.valid(KEY, "", now=1)
    assert not gw.valid(KEY, "garbage", now=1)


def test_the_cookie_domain_is_what_the_panel_and_the_gateway_share():
    assert gw.shared_domain("divan.yakupkeskin.dev", "plane.yakupkeskin.dev") == "yakupkeskin.dev"
    assert gw.shared_domain("divan.a.dev", "plane.b.dev") == ""
    assert gw.shared_domain("100.1.2.3", "100.1.2.3") == ""
    assert gw.shared_domain("a.dev", "b.dev") == ""


def test_the_key_is_kept_between_restarts(tmp_path):
    k = gw.load_key(tmp_path / "plane-gate.key")
    assert gw.load_key(tmp_path / "plane-gate.key") == k
    assert oct((tmp_path / "plane-gate.key").stat().st_mode & 0o777) == "0o600"


def g():
    return gw.PlaneGateway("http://thinkpad:8090/", KEY, ["http://100.1.2.3:8790", "https://*.example.dev"])


def test_plane_may_be_framed_by_the_panel_and_its_redirects_come_back_here():
    out = dict(g()._response_headers([
        ("X-Frame-Options", "DENY"),
        ("Location", "http://thinkpad:8090/?error_code=1"),
        ("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'"),
        ("Transfer-Encoding", "chunked"),
    ], "https://plane.example.dev"))
    assert b"x-frame-options" not in out and b"transfer-encoding" not in out
    assert out[b"location"] == b"https://plane.example.dev/?error_code=1"
    csp = [v for k, v in g()._response_headers([], "x") if k == b"content-security-policy"]
    assert csp == [b"frame-ancestors 'self' http://100.1.2.3:8790 https://*.example.dev"]


def test_plane_sees_its_own_origin_and_never_the_pass():
    h = {"origin": "https://plane.example.dev", "referer": "https://plane.example.dev/skola/?a=1",
         "cookie": f"session-id=s; {gw.PASS_COOKIE}=x; csrftoken=t", "cf-connecting-ip": "1.2.3.4",
         "host": "plane.example.dev", "accept-encoding": "gzip"}
    up = dict(g()._upstream_headers(h, gw._HOP))
    assert up["origin"] == "http://thinkpad:8090"
    assert up["referer"] == "http://thinkpad:8090/skola/?a=1"
    assert up["cookie"] == "session-id=s; csrftoken=t"
    assert "cf-connecting-ip" not in up and "host" not in up


def call(app, headers, path="/"):
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(m):
        sent.append(m)

    scope = {"type": "http", "method": "GET", "path": path, "headers": headers, "query_string": b""}
    asyncio.run(app(scope, receive, send))
    return sent[0]["status"]


def test_nothing_is_served_without_a_pass_on_any_door():
    assert call(g(), [(b"cf-connecting-ip", b"1.2.3.4")]) == 401
    assert call(g(), [(b"cf-connecting-ip", b"1.2.3.4"), (b"cookie", f"{gw.PASS_COOKIE}=bad".encode())]) == 401
    assert call(g(), []) == 401  # the tailnet too


def test_a_pass_says_whose_it_is():
    assert gw.holder(KEY, gw.mint(KEY, "Bedirhan", now=1000), now=1001) == "Bedirhan"
    # audit: language-data — a Turkish name with letters outside ASCII, carried whole
    assert gw.holder(KEY, gw.mint(KEY, "Işıl Ö", now=1000), now=1001) == "Işıl Ö"
    # audit: end-language-data
    assert gw.holder(KEY, gw.mint(KEY, None, now=1000), now=1001) == ""
    exp, who, sig = gw.mint(KEY, "Bedirhan", now=1000).split(".")
    other = "Yakup".encode().hex()
    assert gw.holder(KEY, f"{exp}.{other}.{sig}", now=1001) is None  # nobody becomes somebody else


def sessions(**by_person):
    return gw.PlaneGateway("http://thinkpad:8090", KEY, [], session_for=lambda p: by_person.get(p))


def h(**kw):
    return {k.replace("_", "-"): v for k, v in kw.items()}


def test_each_person_is_signed_in_as_themselves_and_nobody_else():
    gate = sessions(Yakup="s-yakup")
    yakup = h(cookie=f"{gw.PASS_COOKIE}={gw.mint(KEY, 'Yakup')}")
    bedirhan = h(cookie=f"{gw.PASS_COOKIE}={gw.mint(KEY, 'Bedirhan')}")
    assert asyncio.run(gate._signed_in(yakup)) == "s-yakup"
    assert asyncio.run(gate._signed_in(bedirhan)) is None  # no Plane session of his: Plane's own sign-in
    # A browser already signed in keeps its own session.
    own = h(cookie=f"session-id=mine; {gw.PASS_COOKIE}={gw.mint(KEY, 'Yakup')}")
    assert asyncio.run(gate._signed_in(own)) is None


def test_session_names_are_keychain_safe():
    assert gw.session_name("Yakup") == "plane-session-yakup"
    # audit: language-data — the Turkish letters the keychain name folds to ASCII
    assert gw.session_name("İlkay Şen") == "plane-session-ilkay-sen"
    # audit: end-language-data


def test_only_an_email_reaches_planes_shell():
    import pytest
    for bad in ["x", "a@b", "a'@b.co", 'a"@b.co', "a@b.co\nimport os"]:
        with pytest.raises(ValueError):
            gw.mint_session("true", bad)


# ── who does it: a new work item must carry the queue's or the person label ─

def test_only_a_create_is_guarded():
    assert gw.CREATE.match("/api/workspaces/skola/projects/p1/issues/").group(1) == "skola"
    assert gw.CREATE.match("/api/workspaces/skola/projects/p1/issues")
    assert not gw.CREATE.match("/api/workspaces/skola/projects/p1/issues/i1/")
    assert not gw.CREATE.match("/api/workspaces/skola/projects/p1/issues/bulk-delete/")


def guarded(names):
    gate = g()
    gate._label_cache["skola"] = (names, 10 ** 12)
    return gate


def test_a_create_without_who_is_refused_and_with_it_goes_through():
    import json as j
    gate = guarded({"l-bot": gw.BOT, "l-hum": gw.HUMAN, "l-web": "web"})
    run = lambda ids: asyncio.run(gate._unowned("skola", j.dumps({"label_ids": ids}).encode(), {}))
    assert run([]) == gw.MUST_SAY_WHO
    assert run(["l-web"]) == gw.MUST_SAY_WHO
    assert run(["l-web", "l-bot"]) is None
    assert run(["l-hum"]) is None


def test_a_create_is_refused_before_it_reaches_plane():
    import json as j
    gate = guarded({"l-web": "web"})
    sent, asked = [], []

    async def receive():
        return {"type": "http.request", "body": j.dumps({"name": "x", "label_ids": ["l-web"]}).encode(),
                "more_body": False}

    async def send(m):
        sent.append(m)

    async def never(*a, **k):
        asked.append(a)
        raise AssertionError("reached Plane")

    gate.client.send = never
    pass_ = gw.mint(KEY, "Yakup")
    scope = {"type": "http", "method": "POST", "path": "/api/workspaces/skola/projects/p1/issues/",
             "headers": [(b"cookie", f"{gw.PASS_COOKIE}={pass_}".encode())], "query_string": b""}
    asyncio.run(gate(scope, receive, send))
    assert sent[0]["status"] == 400 and not asked
    assert gw.BOT in j.loads(sent[1]["body"])["error"]


def test_the_page_lock_is_in_every_plane_page_before_plane_runs():
    page = gw.with_lock("<!DOCTYPE html><html><head><script src=/a.js></script></head></html>")
    assert page.index("data-divan-lock") < page.index("/a.js")
    assert "label_ids" in gw.LOCK_JS and gw.BOT in gw.LOCK_JS and gw.HUMAN in gw.LOCK_JS


def test_a_plane_page_is_never_kept_by_the_browser():
    import httpx
    gate = g()
    page = b"<!doctype html><html><head></head><body></body></html>"

    async def plane(req):
        return httpx.Response(200, headers={"content-type": "text/html", "cache-control": "max-age=600"}, content=page)

    gate.client = httpx.AsyncClient(transport=httpx.MockTransport(plane))
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(m):
        sent.append(m)

    scope = {"type": "http", "method": "GET", "path": "/skola/projects/",
             "headers": [(b"cookie", f"{gw.PASS_COOKIE}={gw.mint(KEY, 'Yakup')}".encode())], "query_string": b""}
    asyncio.run(gate(scope, receive, send))
    hs = dict(sent[0]["headers"])
    assert sent[0]["status"] == 200 and hs[b"cache-control"] == b"no-cache"
    assert b"data-divan-lock" in sent[1]["body"]
