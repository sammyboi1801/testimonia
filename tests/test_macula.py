"""MACULA ingest (semantic domains, senses, Septuagint equivalents) and the word-domain endpoints."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from testimonia import db
from testimonia.ingest import macula as M
from testimonia.ingest.base import Context
from testimonia.server.app import create_app
from testimonia.sources import load

GREEK_TSV = """xml:id\tref\tenglish\tlemma\tstrong\tdomain\tln
n43001001001\tJHN 1:1!1\tin\tἐν\t1722\t083013\t83.13
n43001001002\tJHN 1:1!2\tbeginning\tἀρχή\t746\t067012\t67.65
n43001001003\tJHN 1:1!3\twas\tεἰμί\t2258\t013001\t13.69
n43001001005\tJHN 1:1!5\tWord\tλόγος\t3056\t033006\t33.98
n43001001008\tJHN 1:1!8\tWord\tλόγος\t3056\t033006 033003\t33.98 33.99
n43001002001\tJHN 1:2!1\tword\tῥῆμα\t4487\t033006\t33.98
n43001003001\tJHN 1:3!1\tword\tλόγος\t3056\t033006\t33.98
n43001003002\tJHN 1:3!2\t\tὁ\t\t\t
"""

GREEK_LABELS = {
    "033": "Communication",
    "033003": "Discourse Types",
    "033006": "Speak, Talk",
    "083": "Spatial Positions",
    "083013": "In, Inside",
    "067": "Time",
    "067012": "Beginning",
    "013": "Be, Become, Exist, Happen",
    "013001": "State",
}

SDBG_XML = """<?xml version='1.0' encoding='UTF-8'?>
<marble-data>
  <morph marbleId="1" Domain="033006;Speak, Talk" SDBG="λόγος;33.98;word, saying, message"/>
  <morph marbleId="2" Domain="033006;Speak, Talk" SDBG="ῥῆμα;33.98;word, saying"/>
  <morph marbleId="3" Domain="033003;Discourse Types" SDBG="λόγος;33.99;statement|υἱός;;son of David"/>
</marble-data>
"""

HEBREW_TSV = """xml:id\tref\tstrongnumberx\tlemma\tenglish\tgreekstrong\tlexdomain
o010010010011\tGEN 1:1!1\t0871a\tבְּ\tin\t1722\t
o010010010031\tGEN 1:1!3\t0430\tאֱלֹהִים\tGod\t2316\t001001001
o010010010032\tGEN 1:1!4\t0430\tאֱלֹהִים\tgods\t2316\t001001001005
o010150010021\tGEN 15:1!2\t1697\tדָּבָר\tword\t3056\t
o010150010031\tGEN 15:1!3\t1961\tהָיָה\twas\t2258\t
o390030190011\tMAL 3:19!1\t1697\tדָּבָר\tthing\t4487\t
"""

HEBREW_LABELS = {"001": "Objects", "001001": "Beings", "001001001": "Deities"}

FIXTURE = """
INSERT INTO source (id, name, license) VALUES ('t', 'test', 'PD'), ('macula-greek', 'MACULA Greek', 'CC-BY-4.0'),
  ('macula-hebrew', 'MACULA Hebrew', 'CC-BY-4.0');
INSERT INTO book (osis, ord, name, testament, chapters) VALUES ('Gen', 1, 'Genesis', 'OT', 50),
  ('Mal', 39, 'Malachi', 'OT', 4), ('John', 43, 'John', 'NT', 21);
INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (1001001, 'Gen.1.1', 'Gen', 1, 1),
  (1015001, 'Gen.15.1', 'Gen', 15, 1), (39004001, 'Mal.4.1', 'Mal', 4, 1),
  (43001001, 'John.1.1', 'John', 1, 1), (43001002, 'John.1.2', 'John', 1, 2), (43001003, 'John.1.3', 'John', 1, 3);
INSERT INTO edition (id, title, language, kind, source_id) VALUES ('tagnt', 'TAGNT', 'grc', 'interlinear', 't'),
  ('tahot', 'TAHOT', 'hbo', 'interlinear', 't'), ('wlc', 'WLC', 'hbo', 'reading_text', 't');
INSERT INTO edition_verse (edition_id, vkey, native_ref, text) VALUES ('wlc', 39004001, 'Mal.3.19', '…');
INSERT INTO lemma (id, language, lemma, gloss) VALUES ('G1722', 'grc', 'ἐν', 'in'), ('G0746', 'grc', 'ἀρχή', 'beginning'),
  ('G1510', 'grc', 'εἰμί', 'to be'), ('G2258', 'grc', 'ἦν', 'was'), ('G3056', 'grc', 'λόγος', 'word'),
  ('G4487', 'grc', 'ῥῆμα', 'word'), ('G2316', 'grc', 'θεός', 'God'), ('H0430G', 'hbo', 'אֱלֹהִים', 'God'),
  ('H1697G', 'hbo', 'דָּבָר', 'word'), ('H7225G', 'hbo', 'רֵאשִׁית', 'beginning'), ('H0871', 'hbo', 'בְּ', 'in'),
  ('H1961', 'hbo', 'הָיָה', 'to be');
INSERT INTO token (edition_id, vkey, pos, surface, lemma_id, editions, word_type) VALUES
  ('tagnt', 43001001, 1, 'Ἐν', 'G1722', 'NA28+SBL', NULL), ('tagnt', 43001001, 2, 'ἀρχῇ', 'G0746', 'NA28+SBL', NULL),
  ('tagnt', 43001001, 3, 'ἦν', 'G1510', 'NA28+SBL', NULL), ('tagnt', 43001001, 4, 'λόγος', 'G3056', 'TR', NULL),
  ('tagnt', 43001001, 5, 'λόγος', 'G3056', 'NA28+SBL', NULL), ('tagnt', 43001001, 8, 'λόγος', 'G3056', 'NA28+SBL', NULL),
  ('tagnt', 43001002, 1, 'ῥῆμα', 'G4487', 'NA28+SBL', NULL), ('tagnt', 43001002, 2, 'λόγος', 'G3056', 'NA28+SBL', NULL),
  ('tahot', 1001001, 1, 'בְּרֵאשִׁית', 'H7225G', NULL, 'L'), ('tahot', 1001001, 3, 'אֱלֹהִים', 'H0430G', NULL, 'L'),
  ('tahot', 1001001, 4, 'אֱלֹהִים', 'H0430G', NULL, 'X'),
  ('tahot', 1015001, 2, 'דְּבַר', 'H1697G', NULL, 'L'), ('tahot', 1015001, 3, 'הָיָה', 'H1961', NULL, 'L'), ('tahot', 39004001, 1, 'דָּבָר', 'H1697G', NULL, 'L');
"""


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    folder = tmp_path_factory.mktemp("macula")
    files = {
        "macula-greek-SBLGNT.tsv": GREEK_TSV,
        "marble-domain-label-mapping.json": json.dumps(GREEK_LABELS),
        "sdbg-domains-glosses.xml": SDBG_XML,
        "macula-hebrew.tsv": HEBREW_TSV,
        "domain-label-mapping-1.json": json.dumps(HEBREW_LABELS),
    }
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8")
    path = folder / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE)
    ctx = Context(con=con, manifest=load())
    ctx.find = lambda source, name: folder / name  # type: ignore[method-assign]
    M.ingest_greek(ctx)
    M.ingest_hebrew(ctx)
    con.commit()
    yield con, path
    con.close()


# ----------------------------------------------------------------------------- parsing


def test_parse_ref_and_strong():
    assert M.parse_ref("MAT 1:1!1") == ("Matt", 1, 1)
    assert M.parse_ref("SNG 2:3!4") == ("Song", 2, 3)
    assert M.parse_ref("XYZ 1:1!1") is None
    assert M.base_strong("H", "0871a") == "H0871"
    assert M.base_strong("G", "746") == "G0746"
    assert M.base_strong("G", "5228+1537+4053") == "G5228"
    assert M.base_strong("G", "1722|1698") == "G1722"
    assert M.base_strong("G", "") == ""


def test_sdbg_parent_follows_the_ln_number():
    assert M.sdbg_parent("33.19", ["010002", "033003"]) == "SDBG:033003"
    assert M.sdbg_parent("93.169a", []) == "LN:93"
    # two subdomains of the same domain: the one at the same position wins
    assert M.sdbg_parent("33.99", ["033006", "033003"], "033003") == "SDBG:033003"


def test_nearest_labelled_and_path():
    find = M.nearest_labelled(HEBREW_LABELS)
    assert find("001001001005") == "001001001"
    assert find("999") == ""
    assert M.sdbh_path("001001001", HEBREW_LABELS) == ["Objects", "Beings", "Deities"]


def test_align_verse_then_chapter_and_preferred():
    words = [M.Word(43001001, "G3056"), M.Word(43001003, "G3056")]
    toks = [
        M.Tok(1, 43001001, "G3056", "G3056", False),  # TR-only word: not preferred
        M.Tok(2, 43001001, "G3056", "G3056", True),
        M.Tok(3, 43001002, "G3056", "G3056", True),
    ]
    hits = M.align(words, toks)
    assert [h.id if h else None for h in hits] == [2, 3]


def test_rekey_inflected_numbers_by_lemma():
    toks = [M.Tok(1, 1, "G1510", "G1510", True)]
    aliases: dict[str, str] = {}
    words = [M.Word(1, "G2258", lemma="εἰμί"), M.Word(1, "G9999", lemma="?")]
    words = M.rekey(words, toks, {"εἰμί": "G1510"}, aliases)
    assert [w.strong for w in words] == ["G1510", "G9999"]
    assert aliases == {"G2258": "G1510"}


# ----------------------------------------------------------------------------- ingest


def test_greek_domains_and_senses(built):
    con, _ = built
    dom = dict(con.execute("SELECT id, parent_id FROM semantic_domain WHERE source_id = 'macula-greek'").fetchall())
    assert dom["SDBG:033006"] == "LN:33"
    assert dom["LN:33.98"] == "SDBG:033006"
    assert dom["LN:33.99"] == "SDBG:033003"
    label = con.execute("SELECT label FROM semantic_domain WHERE id = 'LN:33.98'").fetchone()[0]
    assert label.startswith("word, saying")
    senses = [
        tuple(r) for r in con.execute("SELECT domain_id, gloss FROM lemma_sense WHERE lemma_id = 'G3056' ORDER BY n")
    ]
    assert senses[0] == ("LN:33.98", "word, saying, message")
    assert ("LN:33.99", "statement") in senses
    # the TR-only λόγος (pos 4) gets nothing; the word in John 1:3 lands on the λόγος of John 1:2
    rows = dict(con.execute("SELECT pos + vkey % 10 * 100, domain_id FROM token WHERE lemma_id = 'G3056'").fetchall())
    assert rows[104] is None
    assert rows[105] == "LN:33.98"
    assert rows[108] == "LN:33.98 LN:33.99"
    assert rows[202] == "LN:33.98"
    # ἦν numbered G2258 by MACULA is re-keyed to εἰμί (G1510)
    assert con.execute("SELECT domain_id FROM token WHERE lemma_id = 'G1510'").fetchone()[0] == "LN:13.69"
    assert con.execute("SELECT ln FROM lemma WHERE id = 'G3056'").fetchone()[0].startswith("33.98")


def test_hebrew_domains_and_lxx(built):
    con, _ = built
    assert (
        con.execute("SELECT parent_id FROM semantic_domain WHERE id = 'SDBH:001001001'").fetchone()[0] == "SDBH:001001"
    )
    gloss = con.execute("SELECT gloss FROM lemma_sense WHERE lemma_id = 'H0430G' AND domain_id = 'SDBH:001001001'")
    assert gloss.fetchone()[0] == "god"  # only one of the two words aligns (the second token is LXX-only 'X')
    links = [tuple(r) for r in con.execute("SELECT src, dst, weight FROM entity_link WHERE rel = 'lxx_equivalent'")]
    assert ("lemma:H1697G", "lemma:G3056", 1.0) in links
    assert ("lemma:H1697G", "lemma:G4487", 1.0) in links  # Mal 3:19 (Hebrew) = Mal 4:1 (English)
    assert ("lemma:H0430G", "lemma:G2316", 1.0) in links
    assert ("lemma:H1961", "lemma:G1510", 1.0) in links  # LXX ἦν (G2258) counts for εἰμί, as in the NT
    assert not [x for x in links if x[0] == "lemma:H0871"]  # prefixes stay inside STEPBible's words
    assert con.execute("SELECT lxx_equiv FROM token WHERE vkey = 39004001").fetchone()[0] == "G4487"


# ----------------------------------------------------------------------------- API


@pytest.fixture(scope="module")
def client(built):
    _, path = built
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_word_domains_greek(client):
    r = client.get("/api/word/G3056/domains").json()
    assert r["language"] == "grc"
    top = r["senses"][0]
    assert (top["id"], top["n"], top["field"]) == ("LN:33.98", 3, "SDBG:033006")
    field = r["fields"][0]
    assert field["label"] == "Speak, Talk"
    assert field["words"][0]["id"] == "G4487"
    assert field["words"][0]["same_sense"] is True
    assert field["words"][0]["first"] == "John.1.2"
    assert r["lxx"]["direction"] == "hebrew"
    assert r["lxx"]["words"][0]["id"] == "H1697G"
    assert r["credit"]


def test_word_domains_hebrew(client):
    r = client.get("/api/word/H1697G/domains").json()
    assert r["fields"] == []
    assert {w["id"]: w["n"] for w in r["lxx"]["words"]} == {"G3056": 1, "G4487": 1}
    assert r["lxx"]["words"][0]["lemma"] in ("λόγος", "ῥῆμα")
    r = client.get("/api/word/H0430G/domains").json()
    assert r["fields"][0]["id"] == "SDBH:001001001"
    assert r["fields"][0]["description"] == "Objects › Beings › Deities"


def test_word_domains_validation_and_empty(client):
    assert client.get("/api/word/bogus/domains").status_code == 400
    r = client.get("/api/word/H7225G/domains").json()
    assert r["senses"] == []
    assert r["lxx"]["words"] == []
    assert r["credit"] is None


def test_domain_page(client):
    d = client.get("/api/domains/SDBG:033006").json()
    assert d["label"] == "Speak, Talk"
    assert d["path"] == [{"id": "LN:33", "label": "Communication"}]
    words = {w["id"]: w for w in d["words"]}
    assert set(words) == {"G3056", "G4487"}
    assert words["G3056"]["senses"][0]["code"] == "33.98"
    assert client.get("/api/domains/LN:33").json()["children"][0]["id"] == "SDBG:033003"
    assert client.get("/api/domains/SDBG:999999").status_code == 404
    assert client.get("/api/domains/nonsense").status_code == 400


def test_group_by_strong_merges_sense_split_lemmas():
    from testimonia.server.words import _group_by_strong

    rows = [{"id": "H1697G", "n": 5}, {"id": "H0430G", "n": 3}, {"id": "H1697I", "n": 2}]
    assert _group_by_strong(rows) == [
        {"id": "H1697G", "n": 7, "ids": ["H1697G", "H1697I"]},
        {"id": "H0430G", "n": 3, "ids": ["H0430G"]},
    ]
