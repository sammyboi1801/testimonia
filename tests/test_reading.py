"""Reading aids: Gospel synopsis ingest (BTB pericopes + UBS parallel passages), topics, plans and their API."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from testimonia import db
from testimonia.ingest import finalize, parallels
from testimonia.ingest.base import Context
from testimonia.refs import vkey
from testimonia.server import reading
from testimonia.server.app import create_app
from testimonia.sources import load

M = lambda c, v: vkey("Matt", c, v)  # noqa: E731
K = lambda c, v: vkey("Mark", c, v)  # noqa: E731
L = lambda c, v: vkey("Luke", c, v)  # noqa: E731

# ----------------------------------------------------------------------------- UBS parsing

UBS_XML = """<?xml version="1.0" encoding="utf-8"?>
<Passages>
  <Passage>
    <Verse HEB="000000002222">GEN 1:27</Verse>
    <Verse HEB="22200000000">GEN 5:2</Verse>
  </Passage>
  <Passage>
    <Verse GRK="0202">MAT 3:16-17</Verse>
    <Verse GRK="2512">MRK 1:10</Verse>
  </Passage>
  <Passage>
    <Verse GRK="22">LUK 6:27-28,35</Verse>
    <Verse GRK="22">DEU 16:3</Verse>
  </Passage>
</Passages>
"""


def test_parse_ref_handles_paratext_codes_and_lists():
    assert parallels.parse_ref("LUK 6:27-28,35") == ("Luke", (L(6, 27), L(6, 28), L(6, 35)))
    assert parallels.parse_ref("DEU 16:3") == ("Deut", (vkey("Deut", 16, 3),))
    assert parallels.parse_ref("SNG 2:6")[0] == "Song"  # type: ignore[index]
    assert parallels.parse_ref("MAT 3") is None
    assert parallels.parse_ref("XYZ 1:1") is None


def test_parse_passages(tmp_path):
    path = tmp_path / "ParallelPassages.xml"
    path.write_text(UBS_XML, encoding="utf-8")
    ps = parallels.parse_passages(path)
    assert len(ps) == 3
    mat, mrk = ps[1]
    assert (mat.book, mat.verses, mat.codes, mat.lang) == ("Matt", (M(3, 16), M(3, 17)), "0202", "GRK")
    assert mrk.codes == "2512"


def test_split_and_merge_codes():
    ref = parallels.UbsRef("Matt", (M(3, 16), M(3, 17)), "02532", "GRK")
    # 3–5 mean 0–2 plus a line break: only the match level is kept
    assert parallels.split_codes(ref, {M(3, 16): 2, M(3, 17): 3}) == {M(3, 16): "02", M(3, 17): "202"}
    assert parallels.split_codes(ref, {M(3, 16): 2, M(3, 17): 2}) is None  # word counts disagree
    assert parallels.merge_codes(None, "010") == "010"
    assert parallels.merge_codes("010", "002") == "012"
    assert parallels.merge_codes("01", "002") == "01"


# ----------------------------------------------------------------------------- sections


def _verses() -> parallels.Verses:
    keys = [b(c, v) for b in (M, K, L) for c in (1, 2, 3) for v in range(1, 21)]
    return parallels.Verses(keys)


def test_build_sections_skips_pericopes_already_shown():
    pericopes = [(M(3, 1), M(3, 12), "John the Baptist"), (K(1, 1), K(1, 8), "John"), (K(2, 1), K(2, 5), "Alone")]
    links = {M(3, 1): [(K(1, 1), K(1, 8)), (L(3, 1), L(3, 20)), (M(1, 1), M(1, 2))], K(1, 1): [(M(3, 1), M(3, 12))]}
    secs = parallels.build_sections(pericopes, links, _verses())
    assert [s.id for s in secs] == ["syn:Matt.3.1"]  # Mark's copy is skipped; Mark 2 has no parallels
    assert secs[0].members == [(M(3, 1), M(3, 12)), (K(1, 1), K(1, 8)), (L(3, 1), L(3, 20))]  # same-Gospel link dropped


def test_ubs_ranges_need_two_consecutive_verses():
    v = _verses()
    links = {M(2, 1): [K(2, 5), K(2, 6), L(3, 9)], M(2, 2): [K(2, 7)]}
    assert parallels.ubs_parallel_ranges([(M(2, 1), M(2, 4), "t")], links, v) == {M(2, 1): [(K(2, 5), K(2, 7))]}


def test_attach_codes_only_from_parallels_inside_the_section():
    sec = parallels.Section(
        "syn:Matt.3.13", "Baptism", (M(3, 13), M(3, 17)), [(M(3, 13), M(3, 17)), (K(1, 9), K(1, 11))]
    )
    inside = [parallels.UbsRef("Matt", (M(3, 16),), "021", "GRK"), parallels.UbsRef("Mark", (K(1, 10),), "22", "GRK")]
    outside = [parallels.UbsRef("Matt", (M(3, 16),), "200", "GRK"), parallels.UbsRef("Luke", (L(9, 1),), "2", "GRK")]
    words = {M(3, 16): 3, K(1, 10): 2, L(9, 1): 1}
    parallels.attach_codes([sec], [inside, outside], words)
    assert sec.match == {(M(3, 13), M(3, 17)): {M(3, 16): "021"}, (K(1, 9), K(1, 11)): {K(1, 10): "22"}}


# ----------------------------------------------------------------------------- plans


def test_chapter_plan_is_balanced_and_never_skips_a_day():
    chapters = [("Ps", c, n) for c, n in enumerate([5, 5, 176, 5, 5, 5, 5, 5, 5, 5], start=1)]
    days = reading._chapter_plan(chapters, 6)
    assert len(days) == 6
    assert [c for d in days for r in d for c in r["chapters"]] == list(range(1, 11))
    assert days[0][0]["label"] == "Psalms 1–2"


# ----------------------------------------------------------------------------- API


def _verse_rows(book: str, ord_: int, chapter: int, n: int) -> str:
    return ",".join(
        f"({ord_ * 1_000_000 + chapter * 1000 + v}, '{book}.{chapter}.{v}', '{book}', {chapter}, {v}, 0)"
        for v in range(1, n + 1)
    )


FIXTURE = f"""
INSERT INTO source (id, name, license) VALUES ('t', 'test', 'PD');
INSERT INTO book (osis, ord, name, testament, chapters) VALUES
  ('Gen', 1, 'Genesis', 'OT', 50), ('Matt', 40, 'Matthew', 'NT', 28), ('Mark', 41, 'Mark', 'NT', 16), ('Luke', 42, 'Luke', 'NT', 24);
INSERT INTO verse (vkey, osis, book, chapter, verse, red_letter) VALUES
  {_verse_rows("Gen", 1, 1, 3)}, {_verse_rows("Matt", 40, 3, 17)}, {_verse_rows("Mark", 41, 1, 11)}, {_verse_rows("Luke", 42, 3, 22)};
INSERT INTO edition (id, title, abbrev, language, kind, sort, source_id) VALUES
  ('kjva', 'King James', 'KJV', 'eng', 'translation', 1, 't'), ('bsb', 'Berean', 'BSB', 'eng', 'translation', 2, 't'),
  ('tagnt', 'TAGNT', 'TAGNT', 'grc', 'interlinear', 50, 't');
INSERT INTO edition_verse (edition_id, vkey, text) SELECT 'kjva', vkey, 'kjv ' || osis FROM verse;
INSERT INTO edition_verse (edition_id, vkey, text) VALUES
  ('bsb', {M(3, 16)}, 'As soon as Jesus was baptized, He went up out of the water'),
  ('bsb', {K(1, 10)}, 'As soon as Jesus came up out of the water, He saw the heavens');
INSERT INTO token (edition_id, vkey, pos, surface, normalized, editions) VALUES
  ('tagnt', {M(3, 16)}, 1, 'βαπτισθεὶς', 'βαπτισθεις', 'NA28+TR'), ('tagnt', {M(3, 16)}, 2, 'δὲ', 'δε', 'NA28+TR'),
  ('tagnt', {M(3, 16)}, 3, 'ὁ', 'ο', 'TR'),
  ('tagnt', {K(1, 10)}, 1, 'καὶ', 'και', 'NA28'), ('tagnt', {K(1, 10)}, 2, 'εὐθὺς', 'ευθυς', 'NA28');
INSERT INTO heading (scheme, start_vkey, end_vkey, title, source_id) VALUES
  ('btb-pericope', {M(3, 13)}, {M(3, 17)}, 'The Baptism of Jesus', 't'),
  ('btb-pericope', {vkey("Gen", 1, 1)}, {vkey("Gen", 1, 3)}, 'The Creation', 't');
INSERT INTO parallel_group (id, kind, title, source_id) VALUES ('syn:Matt.3.13', 'synoptic', 'The Baptism of Jesus', 't');
INSERT INTO parallel_member (group_id, start_vkey, end_vkey, role, match_data) VALUES
  ('syn:Matt.3.13', {M(3, 13)}, {M(3, 17)}, 'anchor', '{{"{M(3, 16)}":"02"}}'),
  ('syn:Matt.3.13', {K(1, 9)}, {K(1, 11)}, NULL, '{{"{K(1, 10)}":"222"}}'),
  ('syn:Matt.3.13', {L(3, 21)}, {L(3, 22)}, NULL, NULL);
INSERT INTO chronology_system (id, name) VALUES ('btb', 'BTB');
INSERT INTO verse_date (vkey, system_id, chron_order) SELECT vkey, 'btb',
  CASE book WHEN 'Gen' THEN 1 WHEN 'Mark' THEN 2 WHEN 'Matt' THEN 3 ELSE 4 END FROM verse;
INSERT INTO topic (id, name, body, source_id) VALUES
  ('btb:BAPTISM', 'Baptism', '<p>→ See <a class="wl" data-t="topic WATER">WATER</a></p>', 't'),
  ('btb:WATER', 'Water', '<p>water</p>', 't'), ('btb:CREATION', 'Creation', '<p>made</p>', 't');
INSERT INTO topic_ref (topic_id, start_vkey, end_vkey) VALUES
  ('btb:BAPTISM', {M(3, 16)}, {M(3, 16)}), ('btb:BAPTISM', {K(1, 10)}, {K(1, 10)}), ('btb:BAPTISM', {L(3, 21)}, {L(3, 21)}),
  ('btb:WATER', {M(3, 16)}, {M(3, 16)}), ('btb:WATER', {K(1, 10)}, {K(1, 10)}), ('btb:WATER', {L(3, 21)}, {L(3, 21)}),
  ('btb:CREATION', {vkey("Gen", 1, 1)}, {vkey("Gen", 1, 1)});
INSERT INTO crossref (src_start, src_end, dst_start, dst_end, votes, source_id) VALUES
  ({M(3, 16)}, {M(3, 16)}, {K(1, 10)}, {K(1, 10)}, 20, 't'), ({K(1, 10)}, {K(1, 10)}, {M(3, 16)}, {M(3, 16)}, 18, 't');
INSERT INTO person (id, name, kind, source_id) VALUES ('irenaeus', 'Irenaeus', 'father', 't'), ('augustine', 'Augustine', 'father', 't');
INSERT INTO work (id, author_id, title, category, source_id) VALUES
  ('irenaeus.haer', 'irenaeus', 'Against Heresies', 'church-father', 't'), ('aug.civ', 'augustine', 'City of God', 'church-father', 't');
INSERT INTO citation (start_vkey, end_vkey, work_id, author_id, year, cite, source_id) VALUES
  ({M(3, 16)}, {M(3, 16)}, 'irenaeus.haer', 'irenaeus', 180, '3.9.3', 't'),
  ({M(3, 16)}, {M(3, 16)}, 'aug.civ', 'augustine', 426, '1.1', 't'), ({K(1, 10)}, {K(1, 10)}, 'aug.civ', 'augustine', 426, '1.2', 't'),
  ({vkey("Gen", 1, 1)}, {vkey("Gen", 1, 1)}, 'irenaeus.haer', 'irenaeus', 180, '2.2', 't');
"""


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("reading") / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE)
    finalize.run(Context(con=con, manifest=load()))
    con.commit()
    con.close()
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_topics_index_and_filter(client):
    r = client.get("/api/topics").json()
    assert [t["name"] for t in r["topics"]] == ["Baptism", "Creation", "Water"]
    assert r["topics"][0]["verses"] == 3
    assert [t["id"] for t in client.get("/api/topics", params={"q": "wat"}).json()["topics"]] == ["btb:WATER"]
    assert client.get("/api/topics", params={"q": "100%_"}).json()["topics"] == []


def test_topic_page(client):
    t = client.get("/api/topic/btb:BAPTISM", params={"edition": "bsb"}).json()
    assert [b["book"] for b in t["books"]] == ["Matt", "Mark", "Luke"]
    assert t["verses"][0]["text"].startswith("As soon as Jesus was baptized")
    assert t["verses"][2]["text"] == "kjv Luke.3.21"  # falls back to the KJV where the BSB lacks the verse
    assert t["related"][0] == {"id": "btb:WATER", "name": "Water", "kind": "see"}
    assert [f["name"] for f in t["fathers"]] == ["Irenaeus", "Augustine"]  # pre-Nicene first
    assert t["fathers"][0]["sample"]["osis"] == "Matt.3.16"
    assert t["connections"] == [{"a": "Matt.3.16", "b": "Mark.1.10", "votes": 20}]
    assert [v["osis"] for v in client.get("/api/topic/btb:BAPTISM", params={"book": "Mark"}).json()["verses"]] == [
        "Mark.1.10"
    ]
    assert client.get("/api/topic/btb:NOPE").status_code == 404


def test_plans(client):
    ids = [p["id"] for p in client.get("/api/plans").json()]
    assert ids == ["canonical", "chronological", "nt90", "early-church"]
    canon = client.get("/api/plan/canonical").json()
    labels = [r["label"] for d in canon["days"] for r in d["readings"]]
    assert labels == ["Genesis 1", "Matthew 3", "Mark 1", "Luke 3"]
    chrono = client.get("/api/plan/chronological").json()
    assert [r["book"] for d in chrono["days"] for r in d["readings"]] == ["Gen", "Mark", "Matt", "Luke"]
    early = client.get("/api/plan/early-church").json()["days"]
    assert [d["readings"][0]["title"] for d in early] == ["The Creation", "The Baptism of Jesus"]
    assert early[1]["readings"][0]["citations"] == 1  # Augustine (426) is after Nicaea
    assert client.get("/api/plan/nope").status_code == 404


def test_parallels(client):
    secs = client.get("/api/parallels").json()["sections"]
    assert [s["id"] for s in secs] == ["syn:Matt.3.13"]
    assert secs[0]["passages"]["Mark"][0]["label"] == "Mark 1:9–11"
    assert client.get("/api/parallels", params={"verse": "Luke.3.22"}).json()["sections"][0]["n"] == 1
    assert client.get("/api/parallels", params={"verse": "Gen.1.1"}).json()["sections"] == []
    p = client.get("/api/parallel/syn:Matt.3.13", params={"edition": "bsb"}).json()
    assert [c["gospel"] for c in p["columns"]] == ["Matt", "Mark", "Luke"]
    m16 = next(v for v in p["columns"][0]["passages"][0]["verses"] if v["verse"] == 16)
    assert [w["surface"] for w in m16["greek"]] == ["βαπτισθεὶς", "δὲ"]  # NA28 words only
    assert m16["codes"] == "02"
    k10 = next(v for v in p["columns"][1]["passages"][0]["verses"] if v["verse"] == 10)
    assert k10["codes"] is None  # three codes for two words: not shown
    assert client.get("/api/parallel/syn:nope").status_code == 404
