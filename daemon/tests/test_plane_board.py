"""A product's board is a Plane page: where it opens is worked out from config."""
from divan.config import Config


def cfg(plane):
    c = Config()
    c.plane = plane
    return c


def test_a_mapped_product_opens_its_plane_project():
    c = cfg({"url": "http://thinkpad:8090/", "workspace": "skola", "projects": {"divan": "p1"}})
    assert c.plane_url("divan") == "http://thinkpad:8090/skola/projects/p1/issues/"


def test_an_unmapped_product_opens_the_workspace_project_list():
    c = cfg({"url": "http://thinkpad:8090", "workspace": "skola"})
    assert c.plane_url("babysee") == "http://thinkpad:8090/skola/projects/"


def test_no_plane_is_no_board():
    assert cfg({}).plane_url("divan") == ""
    assert cfg({"url": "http://thinkpad:8090"}).plane_url("divan") == ""


def test_only_http_goes_into_a_web_view():
    assert cfg({"url": "javascript:alert(1)", "workspace": "x"}).plane_url("divan") == ""
    assert cfg({"url": "file:///etc/passwd", "workspace": "x"}).plane_url("divan") == ""
