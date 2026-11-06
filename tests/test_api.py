"""API endpoints against a small, self-contained core database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from testimonia import db
from testimonia.ingest import finalize
from testimonia.ingest.base import Context
from testimonia.server import api
from testimonia.server.app import create_app
from testimonia.sources import load

FIXTURE = """
INSERT INTO source (id, name, license) VALUES ('t', 'test', 'PD');
INSERT INTO book (osis, ord, name, testament, chapters) VALUES ('John', 43, 'John', 'NT', 21), ('Gen', 1, 'Genesis', 'OT', 50);
INSERT INTO verse (vkey, osis, book, chapter, verse, red_letter) VALUES
  (43001001, 'John.1.1', 'John', 1, 1, 0), (43001018, 'John.1.18', 'John', 1, 18, 0),
  (43002001, 'John.2.1', 'John', 2, 1, 0), (1001001, 'Gen.1.1', 'Gen', 1, 1, 0);
INSERT INTO edition (id, title, abbrev, language, kind, sort, source_id) VALUES
  ('kjva', 'King James', 'KJV', 'eng', 'translation', 1, 't'),
  ('tagnt', 'TAGNT', 'TAGNT', 'grc', 'interlinear', 50, 't');
INSERT INTO edition_verse (edition_id, vkey, text) VALUES
  ('kjva', 43001001, 'In the beginning was the Word'),
  ('kjva', 43001018, 'No man hath seen God at any time; the only begotten Son'),
  ('kjva', 43002001, 'And the third day there was a marriage'),
  ('kjva', 1001001, 'In the beginning God created the heaven and the earth.');
INSERT INTO lemma (id, language, lemma, translit, gloss, source_id) VALUES ('G3439', 'grc', 'μονογενής', 'monogenēs', 'unique', 't');
INSERT INTO token (edition_id, vkey, pos, surface, normalized, lemma_id, strong, morph, gloss, editions) VALUES
  ('tagnt', 43001018, 1, 'μονογενὴς', 'μονογενης', 'G3439', 'G3439', 'A-NSM', 'only begotten', 'NA28+TR');
INSERT INTO lexicon (id, title, language, source_id) VALUES ('tbesg', 'TBESG', 'grc', 't');
INSERT INTO lexicon_entry (lexicon_id, lemma_id, headword, body) VALUES ('tbesg', 'G3439', 'μονογενής', 'only-born');
INSERT INTO variant_unit (id, start_vkey, end_vkey, testament, label, significance, source_id)
  VALUES (1, 43001018, 43001018, 'NT', 'θεὸς / υἱός', 'meaning', 't');
INSERT INTO variant_reading (unit_id, n, text, gloss) VALUES (1, 1, 'θεὸς', 'God'), (1, 2, 'υἱός', 'son');
INSERT INTO variant_witness (unit_id, n, witness_type, witness_id) VALUES (1, 1, 'edition', 'NA28'), (1, 2, 'edition', 'TR');
INSERT INTO crossref (src_start, src_end, dst_start, dst_end, votes, source_id) VALUES (43001001, 43001001, 1001001, 1001001, 300, 't');
INSERT INTO person (id, name, kind, floruit_to, source_id) VALUES ('irenaeus', 'Irenaeus', 'father', 202, 't');
INSERT INTO work (id, author_id, title, category, era, source_id) VALUES ('irenaeus.haer', 'irenaeus', 'Against Heresies', 'church-father', 'ante-nicene', 't');
INSERT INTO work_edition (id, work_id, language, kind, source_id) VALUES ('irenaeus.haer@anf01', 'irenaeus.haer', 'eng', 'translation', 't');
INSERT INTO work_section (edition_id, ord, cite, level, title, html, text) VALUES
  ('irenaeus.haer@anf01', 1, '3.11', 2, 'Chapter XI', '<p>the only-begotten God</p>', 'the only-begotten God');
INSERT INTO citation (start_vkey, end_vkey, work_id, edition_id, section_ord, cite, author_id, year, kind, source_id)
  VALUES (43001018, 43001018, 'irenaeus.haer', 'irenaeus.haer@anf01', 1, '3.11', 'irenaeus', 202, 'quotation', 't');
INSERT INTO person (id, name, kind, born, died, tradition, source_id) VALUES ('josephus', 'Flavius Josephus', 'author', 37, 100, 'jewish', 't');
INSERT INTO work (id, author_id, title, category, date_from, date_to, source_id) VALUES ('josephus.antiquities', 'josephus', 'Antiquities of the Jews', 'jewish', 93, 94, 't');
INSERT INTO work_edition (id, work_id, language, kind, source_id) VALUES ('josephus.antiquities@whiston', 'josephus.antiquities', 'eng', 'translation', 't');
INSERT INTO work_section (edition_id, ord, cite, level, title, html, text) VALUES
  ('josephus.antiquities@whiston', 1, 'pref', 1, 'Preface', '<p>Those that undertake…</p>', 'Those that undertake'),
  ('josephus.antiquities@whiston', 2, '18.3', 1, 'Book 18, chapter 3', '<p>Jesus, a wise man</p>', 'Jesus, a wise man');
INSERT INTO citation (start_vkey, end_vkey, work_id, edition_id, section_ord, cite, author_id, year, kind, snippet, source_id)
  VALUES (43001018, 43001018, 'josephus.antiquities', 'josephus.antiquities@whiston', 2, '18.3.3', 'josephus', 94, 'reference', 'a parallel', 't');
INSERT INTO chronology_system (id, name) VALUES ('scholarly', 'Scholarly consensus');
INSERT INTO external_id (entity_type, entity_id, scheme, value) VALUES ('person', 'josephus', 'wikipedia', 'Josephus'),
  ('event', 'destruction-of-temple', 'wikipedia', 'Siege of Jerusalem (70 CE)'), ('book', 'John', 'wikipedia', 'Gospel of John');
INSERT INTO period (id, name, scope, sort, source_id) VALUES ('era-apostolic', 'Apostolic age', 'church', 1, 't');
INSERT INTO event (id, title, kind, source_id) VALUES ('destruction-of-temple', 'Destruction of the Second Temple', 'political', 't');
INSERT INTO dating (entity_type, entity_id, system_id, date_kind, start_year, end_year, circa, source_id) VALUES
  ('period', 'era-apostolic', 'scholarly', 'span', 30, 150, 0, 't'),
  ('event', 'destruction-of-temple', 'scholarly', 'point', 70, 70, 0, 't'),
  ('person', 'josephus', 'scholarly', 'point', 100, 100, 1, 't');
UPDATE dating SET aspect = 'death' WHERE entity_type = 'person';
INSERT INTO entity_attr (uri, key, value, source_id) VALUES ('event:destruction-of-temple', 'timeline.major', 'true', 't');
INSERT INTO meta (key, value) VALUES ('build.version', 'test');
"""


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("api") / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE)
    finalize.run(Context(con=con, manifest=load()))
    con.close()
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_health_and_meta(client):
    assert client.get("/api/health").json()["status"] == "ok"
    m = client.get("/api/meta").json()
    assert [b["osis"] for b in m["books"]] == ["Gen", "John"]
    assert [b["wikipedia"] for b in m["books"]] == [None, "Gospel of John"]
    assert {e["id"] for e in m["editions"]} == {"kjva", "tagnt"}


def test_chapter_with_text_and_words(client):
    r = client.get("/api/chapter/John/1", params={"editions": "kjva,tagnt,nope"}).json()
    assert r["editions"] == ["kjva", "tagnt"]
    v18 = next(v for v in r["verses"] if v["verse"] == 18)
    assert v18["texts"]["kjva"]["text"].startswith("No man")
    assert v18["words"]["tagnt"][0]["lemma_id"] == "G3439"
    assert r["next"] == {"book": "John", "chapter": 2, "name": "John"}
    assert r["prev"]["book"] == "Gen"


def test_chapter_errors(client):
    assert client.get("/api/chapter/John/99").status_code == 404
    assert client.get("/api/chapter/Nope/1").status_code == 404


def test_passage_guide(client):
    g = client.get("/api/verse/John.1.18").json()
    assert g["variants"][0]["readings"][1]["text"] == "υἱός"
    assert [f["author"] for f in g["fathers"]] == ["Irenaeus"]  # Josephus is not a church father…
    assert g["witnesses"][0]["author"] == "Flavius Josephus"  # …he is listed with the Jewish & Roman writers
    assert g["witnesses"][0]["cite"] == "18.3.3"
    assert g["words"]["tagnt"][0]["lemma"] == "μονογενής"
    xr = client.get("/api/verse/John.1.1").json()["crossrefs"]
    assert xr[0]["osis"] == "Gen.1.1"
    assert xr[0]["text"].startswith("In the beginning God")
    assert client.get("/api/verse/John.99.1").status_code == 404


def test_word_study(client):
    w = client.get("/api/word/G3439").json()
    assert w["lemma"]["lemma"] == "μονογενής"
    assert w["total"] == 1
    assert w["occurrences"][0]["osis"] == "John.1.18"
    assert client.get("/api/word/bogus").status_code == 400


def test_library(client):
    works = {w["title"]: w for w in client.get("/api/works").json()}
    assert works["Against Heresies"]["year"] == 202
    assert works["Antiquities of the Jews"]["year"] == 94
    sec = client.get("/api/edition/irenaeus.haer@anf01/section/1").json()
    assert sec["citations"][0]["osis"] == "John.1.18"


def test_search_and_resolve(client):
    r = client.get("/api/search", params={"q": "begotten"}).json()
    assert r["bible"][0]["osis"] == "John.1.18"
    assert "<mark>" in r["bible"][0]["snippet"]
    assert (
        client.get("/api/search", params={"q": "only-begotten"}).json()["works"][0]["work_title"] == "Against Heresies"
    )
    assert client.get("/api/resolve", params={"q": "jn 1:18"}).json()["osis"] == "John.1.18"
    assert client.get("/api/search", params={"q": "John 1:18"}).json()["reference"]["osis"] == "John.1.18"


def test_spa_fallback_without_frontend(client):
    assert client.get("/").status_code == 503
    assert client.get("/api/does-not-exist").status_code == 404


@pytest.mark.parametrize(
    ("q", "expected"), [("only begotten", '"only" "begotten"*'), ("λόγος", '"λόγος"*'), ("()*", "")]
)
def test_fts_query_is_safe(q, expected):
    assert api.fts_query(q) == expected


def test_original_language_search(client):
    r = client.get("/api/search", params={"q": "μονογενης"}).json()
    assert r["bible"][0]["osis"] == "John.1.18"
    assert r["lexicon"][0]["id"] == "G3439"
    assert client.get("/api/search", params={"q": "μονογενὴς"}).json()["bible"][0]["osis"] == "John.1.18"


def test_chapter_marks(client):
    r = client.get("/api/chapter/John/1", params={"editions": "kjva,tagnt"}).json()
    v18 = next(v for v in r["verses"] if v["verse"] == 18)
    assert v18["marks"] == {"variants": 1, "major_variants": 1, "fathers": 1, "pre_nicene": 1, "witnesses": 1}
    assert v18["words"]["tagnt"][0]["lemma"] == "μονογενής"
    assert "marks" not in next(v for v in r["verses"] if v["verse"] == 1)


def test_timeline(client):
    t = client.get("/api/timeline").json()
    assert t["eras"] == [{"id": "era-apostolic", "name": "Apostolic age", "description": None, "start": 30, "end": 150}]
    temple = t["events"][0]
    assert (temple["title"], temple["start"], temple["major"]) == ("Destruction of the Second Temple", 70, True)
    assert temple["wikipedia"] == "Siege of Jerusalem (70 CE)"
    jos = next(a for a in t["authors"] if a["id"] == "josephus")
    assert (jos["born"], jos["died"], jos["wikipedia"], jos["circa"]) == (37, 100, "Josephus", ["death"])
    assert [w["title"] for w in jos["works"]] == ["Antiquities of the Jews"]
    assert jos["category"] == "jewish"


def test_toc_introduction(client):
    toc = client.get("/api/edition/josephus.antiquities@whiston/toc").json()
    assert toc["edition"]["author_wikipedia"] == "Josephus"
    assert toc["edition"]["date_from"] == 93
    assert toc["intro_ord"] is None  # the author's own preface is not an editor's introduction


def test_chapter_marks_keep_witnesses_apart(client):
    v18 = next(v for v in client.get("/api/chapter/John/1").json()["verses"] if v["verse"] == 18)
    assert v18["marks"]["fathers"] == 1
    assert v18["marks"]["witnesses"] == 1
