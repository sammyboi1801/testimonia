"""Study tools: the passage guide, grammar search, word charts and the morphology parser."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from test_api import FIXTURE

from testimonia import db, morphology
from testimonia.ingest import finalize
from testimonia.ingest.base import Context
from testimonia.server.app import create_app
from testimonia.sources import load

EXTRA = """
INSERT INTO edition (id, title, abbrev, language, kind, sort, source_id) VALUES
  ('tahot', 'TAHOT', 'TAHOT', 'hbo', 'interlinear', 50, 't');
INSERT INTO verse (vkey, osis, book, chapter, verse, red_letter) VALUES (43001002, 'John.1.2', 'John', 1, 2, 0),
  (43001019, 'John.1.19', 'John', 1, 19, 0);
INSERT INTO edition_verse (edition_id, vkey, text) VALUES ('kjva', 43001002, 'The same was in the beginning with God.'),
  ('kjva', 43001019, 'And this is the record of John');
INSERT INTO heading (scheme, start_vkey, end_vkey, title) VALUES ('btb-pericope', 43001001, 43001018, 'The Word'),
  ('btb-pericope', 43001019, 43001028, 'The Witness of John');
INSERT INTO lemma (id, language, lemma, translit, gloss, source_id) VALUES
  ('G2316', 'grc', 'θεός', 'theos', 'God', 't'), ('G3588', 'grc', 'ὁ', 'ho', 'the', 't'),
  ('G3089', 'grc', 'λύω', 'luō', 'to loose', 't'), ('H1254A', 'hbo', 'בָּרָא', 'bara', 'to create', 't');
INSERT INTO token (edition_id, vkey, pos, surface, normalized, lemma_id, strong, morph, gloss, editions) VALUES
  ('tagnt', 43001001, 1, 'πρὸς', 'προς', 'G4314', 'G4314', 'PREP', 'with', NULL),
  ('tagnt', 43001001, 2, 'τὸν', 'τον', 'G3588', 'G3588', 'T-ASM', 'the', NULL),
  ('tagnt', 43001001, 3, 'θεόν,', 'θεον', 'G2316', 'G2316', 'N-ASM-T', 'God', NULL),
  ('tagnt', 43001001, 4, 'καὶ', 'και', 'G2532', 'G2532', 'CONJ', 'and', NULL),
  ('tagnt', 43001001, 5, 'θεὸς', 'θεος', 'G2316', 'G2316', 'N-NSM-T', 'God', NULL),
  ('tagnt', 43001002, 1, 'ὁ', 'ο', 'G3588', 'G3588', 'T-NSM', 'the', NULL),
  ('tagnt', 43001002, 2, 'γὰρ', 'γαρ', 'G1063', 'G1063', 'CONJ', 'for', NULL),
  ('tagnt', 43001002, 3, 'θεὸς', 'θεος', 'G2316', 'G2316', 'N-NSM-T', 'God', NULL),
  ('tagnt', 43001002, 4, 'ἐλύθη', 'ελυθη', 'G3089', 'G3089', 'V-API-3S', 'was loosed', 'TR+Byz'),
  ('tagnt', 43002001, 1, 'λύσας', 'λυσας', 'G3089', 'G3089', 'V-AAP-NSM', 'having loosed', NULL),
  ('tahot', 1001001, 1, 'בָּרָא', 'ברא', 'H1254A', 'H1254A', 'HVqp3ms', 'created', NULL),
  ('tahot', 1001001, 2, 'הַשָּׁמַיִם', 'השמים', 'H8064', 'H9009 H8064', 'HTd/Ncmpa', 'the heavens', NULL);
INSERT INTO topic (id, name, source_id) VALUES ('btb:WORD', 'Word', 't');
INSERT INTO topic_ref (topic_id, start_vkey, end_vkey) VALUES ('btb:WORD', 43001001, 43001001), ('btb:WORD', 43001018, 43001018);
INSERT INTO crossref (src_start, src_end, dst_start, dst_end, votes, source_id) VALUES
  (43001018, 43001018, 1001001, 1001001, 20, 't'), (43001001, 43001001, 43001018, 43001018, 50, 't');
INSERT INTO edition_note (edition_id, vkey, n, kind, body, anchor) VALUES ('kjva', 43001018, 1, 'textual', 'Or, God', 'Son');
"""


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("study") / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE + EXTRA)
    finalize.run(Context(con=con, manifest=load()))
    con.close()
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_passage_guide_aggregates_a_range(client):
    g = client.get("/api/passage/John.1.1-John.1.18", params={"edition": "kjva"}).json()
    assert g["range"]["label"] == "John 1:1–18"
    assert [v["osis"] for v in g["verses"]] == ["John.1.1", "John.1.2", "John.1.18"]
    assert g["verses"][0]["text"].startswith("In the beginning")
    assert g["variants"][0]["osis"] == "John.1.18"
    assert len(g["variants"][0]["readings"]) == 2
    (irenaeus,) = g["fathers"]
    assert irenaeus["name"] == "Irenaeus"
    assert irenaeus["pre_nicene"]
    assert irenaeus["verses"] == ["John.1.18"]
    assert g["witnesses"][0]["name"] == "Flavius Josephus"  # Jewish & Roman writers kept apart
    # cross references within the passage are left out; the rest merged by destination, most votes first
    assert [x["osis"] for x in g["crossrefs"]] == ["Gen.1.1"]
    assert g["crossrefs"][0]["from"] == ["John.1.1", "John.1.18"]
    assert g["crossrefs"][0]["votes"] == 300
    assert g["topics"] == [{"id": "btb:WORD", "name": "Word", "n": 2}]
    assert g["footnotes"][0]["osis"] == "John.1.18"
    assert g["next"] == {"title": "The Witness of John", "ref": "John.1.19-John.1.28"}


def test_passage_guide_single_verse_expands_to_its_section(client):
    g = client.get("/api/passage/John.1.2").json()
    assert g["range"]["ref"] == "John.1.1-John.1.18"
    assert client.get("/api/passage/jn 1:19-28").json()["range"]["label"] == "John 1:19"  # only v19 exists here
    assert client.get("/api/passage/Nonsense").status_code == 404


def test_grammar_by_lemma_and_form(client):
    r = client.get("/api/grammar", params={"lemma": "λυω", "tense": "aorist", "voice": "passive"}).json()
    assert r["lemmas"][0]["id"] == "G3089"
    assert r["total"] == 1
    (hit,) = [w for w in r["results"][0]["words"] if w.get("hit")]
    assert hit["surface"] == "ἐλύθη"
    assert hit["parse"] == "aorist passive indicative, 3rd singular"
    assert hit["only_in"] == "TR, Byz"  # not in the NA28 text
    assert r["results"][0]["text"].startswith("The same")
    # transliteration and Strong's numbers find the same word; participles are found by mood
    assert client.get("/api/grammar", params={"lemma": "luo"}).json()["total"] == 2
    p = client.get("/api/grammar", params={"strong": "G3089", "mood": "participle", "case": "nominative"}).json()
    assert [x["osis"] for x in p["results"]] == ["John.2.1"]


def test_grammar_article(client):
    without = client.get("/api/grammar", params={"strong": "G2316", "book": "John", "no_article": 1}).json()
    # τὸν θεόν and ὁ γὰρ θεός have the article; καὶ θεός does not
    assert [(x["osis"], [w["pos"] for w in x["words"] if w.get("hit")]) for x in without["results"]] == [
        ("John.1.1", [5])
    ]
    with_ = client.get("/api/grammar", params={"strong": "G2316", "article": "with"}).json()
    assert with_["total"] == 2
    assert with_["by_book"] == [{"book": "John", "name": "John", "n": 2}]
    heb = client.get("/api/grammar", params={"lang": "hbo", "part": "noun", "article": "with"}).json()
    assert heb["language"] == "hbo"
    assert heb["total"] == 1


def test_grammar_errors(client):
    assert client.get("/api/grammar").status_code == 400
    assert client.get("/api/grammar", params={"tense": "aorist", "stem": "qal"}).status_code == 400
    assert client.get("/api/grammar", params={"tense": "sometime"}).status_code == 400
    assert client.get("/api/grammar", params={"lemma": "ζζζ"}).json()["message"]


def test_word_chart_data(client):
    ch = client.get("/api/word/G2316/chapters").json()["chapters"]
    assert ch == [{"book": "John", "name": "John", "chapter": 1, "n": 3}]
    occ = client.get("/api/word/G3089/book/John").json()
    assert [o["osis"] for o in occ] == ["John.1.2", "John.2.1"]
    assert client.get("/api/word/G3089/book/Nope").status_code == 404


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("V-2AAI-3S", {"tense": "aorist", "voice": "active", "mood": "indicative", "person": "3rd"}),
        ("V-APP-NSM", {"voice": "passive", "mood": "participle", "case": "nominative", "gender": "masculine"}),
        ("V-PNI-3S", {"voice": "middle-passive", "deponent": "yes"}),
        ("P-1GS", {"part": "pronoun", "pronoun": "personal", "person": "1st", "case": "genitive"}),
        ("S-1SNSM", {"pronoun": "possessive", "case": "nominative", "number": "singular", "gender": "masculine"}),
        ("CONJ + G1565=D-NSM", {"part": "conjunction"}),
        ("HVqp3ms", {"stem": "qal", "form": "perfect", "person": "3rd", "gender": "masculine", "number": "singular"}),
        ("Hc/Vhw3mp", {"stem": "hiphil", "form": "sequential imperfect", "number": "plural"}),
        ("HTd/Ncmpa", {"part": "noun", "article": "yes", "number": "plural", "state": "absolute"}),
        ("HR/Vqcc/Sp3ms", {"form": "infinitive construct", "suffix": "yes"}),
        ("ANcbsd/Ta", {"language": "aramaic", "state": "determined", "article": "yes"}),
        ("AVqp3ms", {"language": "aramaic", "stem": "peal"}),
        ("ADV", {"part": "adverb"}),
    ],
)
def test_morphology_parse(code, expected):
    f = morphology.parse(code)
    assert {k: f.get(k) for k in expected} == expected


def test_morphology_matches_and_describes():
    assert morphology.matches("V-2API-3S", {"tense": "aorist", "voice": "passive"})
    assert not morphology.matches("V-AMI-3S", {"voice": "passive"})
    assert morphology.parse("") == {}
    assert morphology.parse(None) == {}
    assert morphology.describe("P-1GS") == "personal pronoun, 1st person genitive singular"
    assert morphology.describe("HVqaa") == "qal infinitive absolute"
