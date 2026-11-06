"""Manuscript transcriptions (CNTR, MES format): parser, markup, ingest step, API and assistant tool.

The fixtures under fixtures/cntr are real lines from the CNTR transcriptions (Alan Bunning, Center for New Testament
Restoration, CC BY-SA 4.0).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from testimonia import db
from testimonia.ingest import finalize, transcriptions
from testimonia.ingest.base import Context
from testimonia.ingest.transcriptions import Correction, Word, leiden, parse_body, parse_word, plain, render
from testimonia.server import agent_tools
from testimonia.server.app import create_app
from testimonia.server.store import Store
from testimonia.server.transcription import _ns_fits, compare, orth, read_markup
from testimonia.sources import load

FIXTURES = Path(__file__).parent / "fixtures" / "cntr"

# ----------------------------------------------------------------------------- parser


def test_word_marks_lacunae_damage_and_nomina_sacra():
    w = parse_word("αυ^τ^ο^υ^")  # a mark follows the letter it qualifies: α, then υτου lost
    assert w.pieces == [("l", "α"), ("m", "υτου")]
    assert w.letters() == "αυτου"
    ns = parse_word("=θν")
    assert ns.ns
    assert ns.letters() == "θν"
    d = parse_word("μο%/νογενησ")
    assert d.pieces == [("l", "μ"), ("d", "ο"), ("lb", ""), ("l", "νογενησ")]
    assert parse_word("~λογοσ").supplied
    vid = parse_word("+=ιηυ")
    assert vid.vid
    assert vid.ns
    assert vid.lost
    page = parse_word("\\522βιβλοσ")
    assert page.pieces[0] == ("pb", "522")
    tail = parse_word("ιουδ^αιων^&/11")
    assert tail.pieces == [("l", "ιου"), ("m", "δ"), ("l", "αιω"), ("m", "ν"), ("gap", "line"), ("lb", "11")]
    assert parse_word("$ιβ").num
    assert parse_word("γα").letters() == "γαμου"  # the μου ligature, written out


def test_body_corrections_and_verse_status():
    segs, status = parse_body("φω/τιζει x{πανταν} {παντα} ανθρωπον")
    assert status == ""
    corr = segs[1]
    assert isinstance(corr, Correction)
    assert [w.letters() for w in corr.text or []] == ["παντα"]
    assert [w.letters() for w in corr.hands["x"]] == ["πανταν"]
    segs, _ = parse_body("ινα x{} {} a{~προσ ~αυτον} ερωτησωσιν")
    corr = segs[1]
    assert isinstance(corr, Correction)
    assert corr.text == []
    assert [w.letters() for w in corr.hands["a"]] == [
        "προσ",
        "αυτον",
    ]
    segs, _ = parse_body("παρακαλω ουν {} b{υμασ} αδελφοι")  # a later hand's addition, no first-hand reading
    assert isinstance(segs[2], Correction)
    assert list(segs[2].hands) == ["b"]
    assert parse_body("-") == ([], "absent")
    assert parse_body("-~") == ([], "absent-vid")
    assert parse_body("+~") == ([], "lost")


def test_plain_text_markup_and_leiden():
    segs, _ = parse_body("/=θν ουδεισ εωρακεν πωποται μο%/νογενησ =θσ ο ων εισ τον κολπον το^υ^ /=πρσ")
    assert plain(segs) == "θν ουδεισ εωρακεν πωποται μονογενησ θσ ο ων εισ τον κολπον του πρσ"
    html = render(segs)
    assert html.startswith('<span class="lb"></span><span class="w ns">θν</span> ')
    assert '<span class="w">μ<span class="d">ο</span><span class="lb"></span>νογενησ</span>' in html
    assert '<span class="w">τ<span class="m">ου</span></span>' in html
    words = [s for s in segs if isinstance(s, Word)]
    assert leiden(words) == "θ̅ν̅ ουδεισ εωρακεν πωποται μο̣νογενησ θ̅σ̅ ο ων εισ τον κολπον τ[ου] π̅ρ̅σ̅"
    segs, _ = parse_body("ανθρωπω¯ x{κρεκραγεν} {κεκραγε}")
    assert plain(segs) == "ανθρωπων κεκραγε"  # the nu-stroke written out
    assert render(segs).endswith('<span class="corr" data-x="κρεκραγεν"><span class="w">κεκραγε</span></span>')
    assert render([], "absent") == '<span class="absent"></span>'
    assert render([], "absent-vid") == '<span class="absent vid"></span>'


def test_markup_reads_back_and_compares_with_the_printed_text():
    segs, _ = parse_body("=θν ουδεισ εορακεν πωποτε ο μονογενησ =θσ ο ων εισ τον κολ/πον του πατροσ εκεινοσ εξηγησατο")
    r = read_markup(render(segs))
    assert r.extant == r.letters
    assert not r.absent
    na28 = [
        "Θεὸν",
        "οὐδεὶς",
        "ἑώρακεν",
        "πώποτε·",
        "μονογενὴς",
        "θεὸς",
        "ὁ",
        "ὢν",
        "εἰς",
        "τὸν",
        "κόλπον",
        "τοῦ",
        "πατρός,",
        "ἐκεῖνος",
        "ἐξηγήσατο.",
    ]
    marks, missing = compare(r, na28)
    assert [w.letters for w, m in zip(r.words, marks, strict=True) if m] == ["ο"]  # P75's ὁ before μονογενής
    assert missing == []
    assert orth("εορακεν") == orth("ἑώρακεν")
    assert orth("εκινοσ") == orth("ἐκεῖνος")
    assert orth("ειπε") == orth("εἶπεν")
    assert _ns_fits("πρσ", "πατρός,")
    assert _ns_fits("ιηλ", "Ἰσραήλ")
    assert _ns_fits("σ⳨ον", "σταυρόν")
    assert not _ns_fits("θσ", "κύριος")
    lost = read_markup(render(parse_body("~ουκ ~εξεστιν ιουδ^α^ι^ω^ν^")[0]))
    assert lost.extant == 3
    assert lost.leiden == "[ουκ εξεστιν] ιου[δαιων]"


# ----------------------------------------------------------------------------- ingest + API

SQL = """
INSERT INTO source (id, name, license) VALUES ('t', 'test', 'PD');
INSERT INTO versification (id, name) VALUES ('eng', 'English (KJV) hub');
INSERT INTO book (osis, ord, name, testament, chapters) VALUES ('John', 43, 'John', 'NT', 21), ('Rom', 45, 'Romans', 'NT', 16);
INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES
  (43001001, 'John.1.1', 'John', 1, 1), (43001009, 'John.1.9', 'John', 1, 9), (43001018, 'John.1.18', 'John', 1, 18),
  (43001019, 'John.1.19', 'John', 1, 19), (43005004, 'John.5.4', 'John', 5, 4),
  (43018031, 'John.18.31', 'John', 18, 31), (43018033, 'John.18.33', 'John', 18, 33), (45004004, 'Rom.4.4', 'Rom', 4, 4);
INSERT INTO edition (id, title, abbrev, language, kind, sort, source_id) VALUES
  ('kjva', 'King James', 'KJV', 'eng', 'translation', 1, 't'), ('tagnt', 'TAGNT', 'TAGNT', 'grc', 'interlinear', 50, 't');
INSERT INTO edition_verse (edition_id, vkey, text) VALUES ('kjva', 43001018, 'No man hath seen God at any time');
INSERT INTO token (edition_id, vkey, pos, surface, normalized, editions) VALUES
  ('tagnt', 43001018, 1, 'Θεὸν', 'θεον', 'NA28+TR'), ('tagnt', 43001018, 2, 'οὐδεὶς', 'ουδεις', 'NA28+TR'),
  ('tagnt', 43001018, 3, 'ἑώρακεν', 'εωρακεν', 'NA28+TR'), ('tagnt', 43001018, 4, 'πώποτε·', 'πωποτε', 'NA28+TR'),
  ('tagnt', 43001018, 5, 'ὁ', 'ο', 'TR'), ('tagnt', 43001018, 6, 'μονογενὴς', 'μονογενης', 'NA28+TR'),
  ('tagnt', 43001018, 7, 'θεὸς', 'θεος', 'NA28'), ('tagnt', 43001018, 8, 'υἱός', 'υιος', 'TR'),
  ('tagnt', 43001018, 9, 'ὁ', 'ο', 'NA28+TR'), ('tagnt', 43001018, 10, 'ὢν', 'ων', 'NA28+TR'),
  ('tagnt', 43001018, 11, 'εἰς', 'εις', 'NA28+TR'), ('tagnt', 43001018, 12, 'τὸν', 'τον', 'NA28+TR'),
  ('tagnt', 43001018, 13, 'κόλπον', 'κολπον', 'NA28+TR'), ('tagnt', 43001018, 14, 'τοῦ', 'του', 'NA28+TR'),
  ('tagnt', 43001018, 15, 'πατρός,', 'πατρος', 'NA28+TR'), ('tagnt', 43001018, 16, 'ἐκεῖνος', 'εκεινος', 'NA28+TR'),
  ('tagnt', 43001018, 17, 'ἐξηγήσατο.', 'εξηγησατο', 'NA28+TR');
INSERT INTO manuscript (id, sigla, name, collection, date_from, date_to, date_label, source_id) VALUES
  ('GA:P52', 'P52', 'Papyrus 52', 'NT papyri', 110, 140, '110-140', 't'),
  ('GA:P66', 'P66', 'Papyrus 66', 'NT papyri', 150, 250, '150-250', 't'),
  ('GA:P75', 'P75', 'Papyrus 75', 'NT papyri', 200, 225, '200-225', 't'),
  ('GA:P45', 'P45', 'Papyrus 45', 'NT papyri', 200, 300, '~250', 't'),
  ('GA:03', '03 B', 'Codex Vaticanus', 'NT majuscules', 301, 400, '4th', 't'),
  ('GA:02', '02 A', 'Codex Alexandrinus', 'NT majuscules', 401, 500, '5th', 't');
"""


class FixtureContext(Context):
    def paths(self, source_id: str) -> list[Path]:
        assert source_id == transcriptions.SOURCE
        return [FIXTURES]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    path = tmp_path_factory.mktemp("cntr") / "core.db"
    con = db.create_core(path)
    con.executescript(SQL)
    ctx = FixtureContext(con=con, manifest=load())
    mp = pytest.MonkeyPatch()
    mp.setattr(transcriptions, "MIN_MANUSCRIPTS", 1)
    ctx.register(transcriptions.SOURCE)
    transcriptions.ingest_transcriptions(ctx)
    transcriptions.ingest_transcriptions(ctx)  # the step is re-runnable
    mp.undo()
    finalize.run(ctx)
    con.commit()
    yield path, con
    con.close()


def test_ingest_links_transcriptions_to_manuscripts(built):
    _, con = built
    eds = con.execute(
        "SELECT id, manuscript_id, kind, abbrev, language FROM edition WHERE source_id = 'cntr' ORDER BY sort"
    ).fetchall()
    # earliest first; 0326 has no catalogue entry and is skipped
    assert [tuple(e) for e in eds] == [
        ("cntr:P52", "GA:P52", "manuscript", "P52", "grc"),
        ("cntr:P66", "GA:P66", "manuscript", "P66", "grc"),
        ("cntr:P75", "GA:P75", "manuscript", "P75", "grc"),
        ("cntr:P45", "GA:P45", "manuscript", "P45", "grc"),
        ("cntr:03", "GA:03", "manuscript", "03", "grc"),
        ("cntr:02", "GA:02", "manuscript", "02", "grc"),
    ]
    rows = dict(con.execute("SELECT edition_id || ' ' || vkey, text FROM edition_verse WHERE edition_id LIKE 'cntr:%'"))
    assert len(rows) == 13  # Vaticanus' Rom 4:4, written twice, is one verse
    assert rows["cntr:P66 43001018"].startswith("θν ουδεισ εωρακεν πωποται μονογενησ θσ")
    assert rows["cntr:P66 43005004"] == ""  # the verse is absent
    assert rows["cntr:03 45004004"] == "τω δε εργαζομενω ο μισθοσ ου λογιζεται κατα χαριν αλλα κατα οφειλημα"
    markup = con.execute(
        "SELECT markup FROM edition_verse WHERE edition_id = 'cntr:P45' AND vkey = 43005004"
    ).fetchone()
    assert markup[0] == '<span class="absent vid"></span>'
    meta = dict(con.execute("SELECT key, value FROM meta WHERE key LIKE 'transcriptions.%'"))
    assert meta == {"transcriptions.manuscripts": "6", "transcriptions.verses": "13"}


@pytest.fixture(scope="module")
def client(built):
    path, _ = built
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_api_manuscript_page_and_text(client):
    page = client.get("/api/manuscript/GA:P66").json()
    t = page["transcription"]
    assert t["id"] == "cntr:P66"
    assert t["verses"] == 5
    assert t["license"] == "CC-BY-SA-4.0"
    assert t["books"] == [
        {"osis": "John", "name": "John", "chapters": [{"chapter": 1, "verses": 4}, {"chapter": 5, "verses": 1}]}
    ]
    text = client.get("/api/manuscript/GA:P66/text").json()
    assert (text["book"], text["chapter"], text["prev"]) == ("John", 1, None)
    assert text["next"] == {"book": "John", "chapter": 5, "label": "John 5"}
    assert [v["verse"] for v in text["verses"]] == [1, 9, 18, 19]
    assert 'class="corr"' in text["verses"][1]["markup"]
    five = client.get("/api/manuscript/GA:P66/text", params={"book": "John", "chapter": 5}).json()
    assert five["verses"][0]["markup"] == '<span class="absent"></span>'
    assert client.get("/api/manuscript/GA:P66/text", params={"book": "John", "chapter": 7}).status_code == 404
    assert client.get("/api/manuscript/GA:nope/text").status_code == 404
    meta = client.get("/api/meta").json()
    assert all(e["kind"] != "manuscript" for e in meta["editions"])  # not offered as reading texts


def test_api_verse_as_the_manuscripts_read_it(client):
    v = client.get("/api/verse/John.1.18/transcriptions").json()
    assert v["total"] == 3
    assert [m["id"] for m in v["manuscripts"]] == ["GA:P66", "GA:P75", "GA:02"]
    p66, p75, a = v["manuscripts"]
    assert p66["differs"] == 0
    assert p66["extant"] < 1
    assert p75["differs"] == 1
    assert '<span class="w diff" data-p="—">ο</span>' in p75["markup"]
    assert '<span class="w diff" data-p="θεὸς">υιοσ</span>' in a["markup"]
    assert v["printed"].startswith("Θεὸν οὐδεὶς")
    assert "υἱός" not in v["printed"]
    assert client.get("/api/verse/John.1.18/transcriptions", params={"limit": 1}).json()["manuscripts"][0]["id"] == (
        "GA:P66"
    )
    absent = client.get("/api/verse/John.5.4/transcriptions", params={"limit": 10}).json()
    assert {m["id"]: m["absent"] for m in absent["manuscripts"]} == {
        "GA:P66": True,
        "GA:P75": True,
        "GA:P45": True,
        "GA:02": False,
    }
    p52 = client.get("/api/verse/John.18.31/transcriptions").json()["manuscripts"][0]
    assert p52["id"] == "GA:P52"
    assert p52["leiden"].startswith("[…]οι ιουδαιο̣ι̣ ημε[ιν ουκ εξεστιν αποκτειναι]")


def test_assistant_quotes_the_manuscripts(built):
    path, _ = built
    store = Store(path)
    text, is_error = agent_tools.run(store, "manuscript_text", {"reference": "John 1:18"})
    assert not is_error
    assert "P66 Papyrus 66 (150-250, /manuscript/GA:P66): θ̅ν̅ ουδεισ εωρακεν πωποται" in text
    assert "02 A Codex Alexandrinus" in text
    assert "difference(s) from NA28" in text
    assert "CC BY-SA 4.0" in text
    one, _ = agent_tools.run(store, "manuscript_text", {"reference": "John 1:1-19", "manuscript": "𝔓66"})
    assert one.startswith("# P66 Papyrus 66")
    assert "- John 1:9:" in one
    assert "{corr. first hand" in one
    none, _ = agent_tools.run(store, "manuscript_text", {"reference": "John 1:18", "manuscript": "P999"})
    assert "No transcription" in none
    absent, _ = agent_tools.run(store, "manuscript_text", {"reference": "John 5:4"})
    assert "(verse absent)" in absent
    assert "does not have this verse" in absent
