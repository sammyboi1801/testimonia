"""Live sources (OpenAlex, Sefaria, Wikimedia Commons): parsing, licences, caching and the opt-in. No network:
every request is answered by a stand-in."""

from __future__ import annotations

import httpx

from testimonia.server import agent_tools, online


def _serve(monkeypatch, handler):
    calls: list[str] = []

    def client():
        def wrapped(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url))
            return handler(request)

        return httpx.Client(transport=httpx.MockTransport(wrapped), headers=online.HEADERS)

    monkeypatch.setattr(online, "_client", client)
    online._cache.clear()
    return calls


def test_licences():
    for ok in ("Public domain", "CC0", "CC BY 4.0", "CC BY-SA 3.0", "CC-BY", "CC-BY-SA", "PD-old"):
        assert online._open_licence(ok), ok
    for no in ("CC BY-NC 4.0", "CC BY-ND 2.0", "CC-BY-NC", "Copyright", "", None):
        assert not online._open_licence(no), no


def test_scholarship_parses_and_is_kept(monkeypatch):
    work = {
        "display_name": "<i>Destroy This Temple</i>: Issues of History in John 2:13–22",
        "publication_year": 2017,
        "doi": "https://doi.org/10.1/x",
        "cited_by_count": 4,
        "open_access": {"is_oa": True, "oa_url": "https://example.org/free.pdf"},
        "authorships": [{"author": {"display_name": f"A{i}"}} for i in range(5)],
        "primary_location": {"source": {"display_name": "Neotestamentica"}},
        "abstract_inverted_index": {"Jesus": [0], "the": [2], "cleansed": [1], "temple.": [3]},
    }
    calls = _serve(monkeypatch, lambda r: httpx.Response(200, json={"results": [work]}))
    works = online.scholarship("John 2:13-22 temple")
    assert works == [
        {
            "title": "Destroy This Temple : Issues of History in John 2:13–22",
            "year": 2017,
            "authors": ["A0", "A1", "A2"],
            "more_authors": 2,
            "venue": "Neotestamentica",
            "type": None,
            "cited_by": 4,
            "url": "https://doi.org/10.1/x",
            "free_url": "https://example.org/free.pdf",
            "abstract": "Jesus cleansed the temple.",
        }
    ]
    assert "primary_topic.field.id%3A12" in calls[0]  # Arts & Humanities only
    online.scholarship("john 2:13-22   temple")  # the same search, kept
    assert len(calls) == 1
    text = agent_tools.scholarship(None, "John 2:13-22 temple")  # type: ignore[arg-type]
    assert "A0, A1, A2 et al. (2017)" in text
    assert "free to read: https://example.org/free.pdf" in text


def test_a_source_that_cannot_be_reached_says_so(monkeypatch):
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    _serve(monkeypatch, down)
    assert online.scholarship("anything") is None
    assert "could not be reached" in agent_tools.scholarship(None, "anything")  # type: ignore[arg-type]
    assert online.art("anything") is None


class _Store:
    """Only what sefaria_ref asks of the store: the Hebrew numbering of a verse."""

    def __init__(self, native: dict[int, str]):
        self.native = native

    def one(self, sql, params):
        n = self.native.get(params[0])
        return {"native_ref": n} if n else None


def test_sefaria_numbers_verses_the_hebrew_way():
    s = _Store({19051001: "Ps.51.3", 39004001: "Mal.3.19"})
    assert online.sefaria_ref(s, "Ps.51.1") == "Psalms 51:3"
    assert online.sefaria_ref(s, "Mal.4.1") == "Malachi 3:19"
    assert online.sefaria_ref(s, "Isa.53.5") == "Isaiah 53:5"  # the same in both: no native number kept
    assert online.sefaria_ref(s, "John.3.16") is None  # no New Testament on Sefaria


def test_jewish_sources_quote_only_open_translations(monkeypatch):
    links = [
        {"category": "Commentary", "collectiveTitle": {"en": "Rashi"}, "ref": "Rashi on Isaiah 53:5:1", "compDate": [1075], "sourceHasEn": True},
        {"category": "Commentary", "collectiveTitle": {"en": "Rashi"}, "ref": "Rashi on Isaiah 53:5:2", "compDate": [1075], "sourceHasEn": True},
        {"category": "Targum", "index_title": "Targum Jonathan on Isaiah", "ref": "Targum Jonathan on Isaiah 53:5", "compDate": [-150], "sourceHasEn": True},
        {"category": "Midrash", "index_title": "Some Midrash", "ref": "Some Midrash 1:2", "compDate": [700], "sourceHasEn": True},
        {"category": "Kabbalah", "index_title": "Zohar", "ref": "Zohar 1:1", "sourceHasEn": True},
    ]  # fmt: skip
    texts = {
        "Rashi_on_Isaiah_53:5:1": {"language": "en", "text": "<b>the chastisement</b> due to us", "license": "CC-BY", "versionTitle": "Judaica Press"},
        "Targum_Jonathan_on_Isaiah_53:5": {"language": "en", "text": ["He shall build", "the sanctuary"], "license": "Public Domain", "versionTitle": "Stenning"},
        "Some_Midrash_1:2": {"language": "en", "text": "closed text", "license": "CC-BY-NC", "versionTitle": "Closed"},
    }  # fmt: skip

    def handler(r: httpx.Request) -> httpx.Response:
        if "/api/links/" in r.url.path:
            assert r.url.path.endswith("/Isaiah_53:5")
            return httpx.Response(200, json=links)
        key = r.url.path.rsplit("/", 1)[1]
        return httpx.Response(200, json={"versions": [texts[key]]})

    _serve(monkeypatch, handler)
    data = online.jewish(_Store({}), "Isa.53.5")
    assert [e["title"] for e in data["sources"]] == ["Targum Jonathan on Isaiah", "Some Midrash", "Rashi"]
    targum, midrash, rashi = data["sources"]
    assert targum["text"] == "He shall build the sanctuary"
    assert rashi["text"] == "the chastisement due to us"
    assert "text" not in midrash  # linked, never quoted
    assert midrash["licence"] == "CC-BY-NC"


def test_art_keeps_only_free_images_two_per_artist(monkeypatch):
    def page(i, licence, artist):
        return {
            "title": f"File:Painting {i}.jpg",
            "index": i,
            "imageinfo": [
                {
                    "thumburl": f"https://upload.example/{i}.jpg",
                    "descriptionurl": f"https://commons.example/{i}",
                    "extmetadata": {"LicenseShortName": {"value": licence}, "Artist": {"value": f"<a>{artist}</a>"}},
                }
            ],
        }

    pages = [page(1, "Public domain", "Tanner"), page(2, "CC BY-NC 2.0", "Someone"), page(3, "Public domain", "Tanner"), page(4, "Public domain", "Tanner"), page(5, "CC BY-SA 4.0", "Tissot")]  # fmt: skip
    _serve(monkeypatch, lambda r: httpx.Response(200, json={"query": {"pages": pages}}))
    images = online.art("Jesus and Nicodemus")
    assert [i["title"] for i in images] == ["Painting 1", "Painting 3", "Painting 5"]
    assert images[0]["artist"] == "Tanner"


def test_jewish_sources_are_offered_only_when_turned_on():
    agent_tools.READER.set({})
    assert "jewish_sources" not in [t["name"] for t in agent_tools.offered()]
    assert "scholarship" in [t["name"] for t in agent_tools.offered()]
    agent_tools.READER.set({"jewish": True})
    assert "jewish_sources" in [t["name"] for t in agent_tools.offered()]
    agent_tools.READER.set({})
