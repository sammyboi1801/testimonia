"""Kings and rulers: the curated tables, chronology systems, the Wikidata parser, the ingest, the API and the
assistant tool."""

from __future__ import annotations

import itertools

import pytest
from fastapi.testclient import TestClient

from testimonia import db
from testimonia.ingest import curated, finalize, rulers
from testimonia.ingest.base import Context, IngestError
from testimonia.server import agent_tools
from testimonia.server import rulers as rulers_api
from testimonia.server.app import create_app
from testimonia.server.store import Store
from testimonia.sources import load

# ----------------------------------------------------------------------------- parsing


def test_parse_year_reads_bc_and_ad():
    assert rulers.parse_year("931 BC") == -930
    assert rulers.parse_year("1 BC") == 0
    assert rulers.parse_year("4 bc") == -3
    assert rulers.parse_year("14") == 14
    assert rulers.parse_year("AD 395") == 395
    for bad in ("0", "c. 700 BC", "-700", ""):
        with pytest.raises(IngestError):
            rulers.parse_year(bad)


REALMS = [
    {"id": "judah", "name": "Kingdom of Judah", "short": "Judah", "office": "King of Judah", "style": "of",
     "kind": "local", "sort": "1", "systems": "thiele|galil", "overlord_from": "", "overlord_to": "",
     "description": "", "citation": "x"},
    {"id": "babylon", "name": "Babylon", "short": "Babylon", "office": "King of Babylon", "style": "of",
     "kind": "overlord", "sort": "2", "systems": "scholarly", "overlord_from": "605 BC", "overlord_to": "539 BC",
     "description": "", "citation": "x"},
]  # fmt: skip
RULERS = [
    {"person": "hezekiah", "name": "Hezekiah", "realm": "judah", "office": "", "dynasty": "", "scope": "",
     "theographic": "hezekiah_1512", "wikipedia": "Hezekiah", "verses": "", "note": ""},
    {"person": "merodach", "name": "Merodach-baladan", "realm": "babylon", "office": "", "dynasty": "", "scope": "",
     "theographic": "", "wikipedia": "", "verses": "Isa.39.1", "note": ""},
    {"person": "merodach", "name": "Merodach-baladan", "realm": "babylon", "office": "", "dynasty": "", "scope": "",
     "theographic": "", "wikipedia": "", "verses": "", "note": ""},
]  # fmt: skip


def reign(holding, system, start, end, shared="", kind="", citation="src"):
    return {"holding": holding, "system": system, "start": start, "end": end, "approx": "", "shared_from": shared,
            "shared_kind": kind, "label": "", "citation": citation}  # fmt: skip


def test_curated_rows_are_validated():
    realms = rulers.read_realms(REALMS)
    assert realms["babylon"].overlord == (-604, -538)
    assert realms["judah"].systems == ("thiele", "galil")
    holdings = rulers.read_holdings(RULERS, realms)
    assert [h.id for h in holdings] == ["hezekiah@judah", "merodach@babylon", "merodach@babylon.2"]
    assert holdings[0].office == "King of Judah"  # the realm's office by default
    assert [h.seq for h in holdings] == [1, 1, 2]
    systems = {"thiele", "galil", "scholarly"}
    rows = [
        reign("hezekiah@judah", "thiele", "716 BC", "687 BC"),
        reign("hezekiah@judah", "galil", "726 BC", "697 BC"),
        reign("merodach@babylon", "scholarly", "722 BC", "710 BC"),
        reign("merodach@babylon.2", "scholarly", "703 BC", "703 BC"),
    ]
    out = rulers.read_reigns(rows, holdings, realms, systems)
    assert (out[0].start, out[0].end) == (-715, -686)
    with pytest.raises(IngestError, match="default system"):  # Hezekiah needs a Thiele date
        rulers.read_reigns(rows[1:], holdings, realms, systems)
    with pytest.raises(IngestError, match="not listed"):
        rulers.read_reigns([*rows, reign("merodach@babylon", "thiele", "722 BC", "710 BC")], holdings, realms, systems)
    with pytest.raises(IngestError, match="shared_from"):
        rulers.read_reigns([reign("hezekiah@judah", "thiele", "716 BC", "687 BC", "700 BC", "coregency"), *rows[1:]],
                           holdings, realms, systems)  # fmt: skip
    with pytest.raises(IngestError, match="cites"):
        rulers.read_reigns([reign("hezekiah@judah", "thiele", "716 BC", "687 BC", citation=""), *rows[1:]],
                           holdings, realms, systems)  # fmt: skip
    with pytest.raises(IngestError, match="bad verse"):
        rulers.read_holdings([{**RULERS[0], "verses": "Nope.1.1"}], realms)


def test_the_curated_tables_load_and_agree_with_known_dates():
    systems = {r["id"] for r in curated.read_csv("chronology_systems.csv", ("id", "name"))}
    realms, holdings, reigns = rulers.load_curated(systems)
    assert len(realms) >= 15
    assert len(holdings) > 200
    by = {(g.holding, g.system): g for g in reigns}
    assert (by["hezekiah@judah", "thiele"].start, by["hezekiah@judah", "thiele"].end) == (-715, -686)
    assert by["hezekiah@judah", "galil"].start == -725
    assert by["hezekiah@judah", "albright"].start == -714
    uzziah = by["uzziah@judah", "thiele"]
    assert (uzziah.shared_from, uzziah.shared_kind) == (-791, "coregency")  # coregent from 792/91 BC
    assert by["pekah@israel", "thiele"].shared_kind == "rival"
    assert (by["sennacherib@assyria", "scholarly"].start, by["sennacherib@assyria", "scholarly"].end) == (-704, -680)
    assert by["augustus@rome", "scholarly"].start == -26  # 27 BC
    assert by["pontius-pilate@judaea", "scholarly"].end == 36
    for realm in ("judah", "israel"):  # Thiele's kings follow one another without gaps or reversals
        thiele = [by[h.id, "thiele"] for h in holdings if h.realm == realm]
        for prev, nxt in itertools.pairwise(thiele):
            assert nxt.shared_from or nxt.start >= prev.start, (prev.holding, nxt.holding)
            assert nxt.start - prev.end <= 1, (prev.holding, nxt.holding)
    assert all(g.citation for g in reigns)
    assert all(h.wikipedia for h in holdings if h.realm not in ("high-priests", "judaea"))


# ----------------------------------------------------------------------------- Wikidata


BINDINGS = [
    {"title": {"value": "Hezekiah"}, "item": {"value": "http://www.wikidata.org/entity/Q244912"},
     "pos": {"value": "http://www.wikidata.org/entity/Q1"}, "posLabel": {"value": "King of Judah"},
     "start": {"value": "-0714-01-01T00:00:00Z"}, "startPrec": {"value": "9"},
     "end": {"value": "-0685-01-01T00:00:00Z"}, "endPrec": {"value": "9"}},
    {"title": {"value": "Tiberius"}, "item": {"value": "http://www.wikidata.org/entity/Q1407"},
     "pos": {"value": "http://www.wikidata.org/entity/Q2"}, "posLabel": {"value": "Roman consul"},
     "start": {"value": "-0012-01-01T00:00:00Z"}, "startPrec": {"value": "9"},
     "end": {"value": "-0012-01-01T00:00:00Z"}, "endPrec": {"value": "9"}},
    {"title": {"value": "Tiberius"}, "item": {"value": "http://www.wikidata.org/entity/Q1407"},
     "pos": {"value": "http://www.wikidata.org/entity/Q842606"}, "posLabel": {"value": "Roman emperor"},
     "start": {"value": "0014-09-18T00:00:00Z"}, "startPrec": {"value": "11"},
     "end": {"value": "0037-03-16T00:00:00Z"}, "endPrec": {"value": "11"}},
    {"title": {"value": "Belshazzar"}, "item": {"value": "http://www.wikidata.org/entity/Q225198"}},
]  # fmt: skip


def test_wikidata_results_are_parsed():
    assert rulers.wikidata_year("-0715-01-01T00:00:00Z") == -715  # astronomical, as the query service returns
    assert rulers.wikidata_year("0014-08-19T00:00:00Z") == 14
    items = rulers.parse_wikidata(BINDINGS)
    assert items["Belshazzar"] == ("Q225198", [])
    qid, statements = items["Tiberius"]
    assert qid == "Q1407"
    assert len(statements) == 2
    best = rulers.choose_statement(statements, 14, 37, "Q842606")
    assert best is not None
    assert best.label == "Roman emperor"
    assert best.precision == 11
    assert rulers.choose_statement(statements, 300, 310, None) is None  # nothing near: another office


# ----------------------------------------------------------------------------- ingest, API, tool


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    path = tmp_path_factory.mktemp("rulers") / "core.db"
    con = db.create_core(path)
    ctx = Context(con=con, manifest=load())
    ctx.register(curated.SOURCE)
    curated.ingest_curated(ctx)
    con.executescript(
        """
        INSERT INTO source (id, name, license) VALUES ('theographic', 'Theographic', 'CC-BY-SA-4.0');
        INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (12018013, '2Kgs.18.13', '2Kgs', 18, 13),
          (42003001, 'Luke.3.1', 'Luke', 3, 1), (1012001, 'Gen.12.1', 'Gen', 12, 1);
        INSERT INTO person (id, name, kind, source_id) VALUES ('hezekiah-1512', 'Hezekiah', 'biblical', 'theographic'),
          ('sennacherib', 'Sennacherib', 'biblical', 'theographic'), ('pilate', 'Pontius Pilate', 'biblical', 'theographic');
        INSERT INTO external_id (entity_type, entity_id, scheme, value) VALUES
          ('person', 'hezekiah-1512', 'theographic', 'hezekiah_1512'), ('person', 'sennacherib', 'theographic', 'sennacherib_2489'),
          ('person', 'pilate', 'theographic', 'pilate_2365');
        INSERT INTO person_ref (person_id, vkey) VALUES ('hezekiah-1512', 12018013), ('sennacherib', 12018013), ('pilate', 42003001);
        INSERT INTO verse_date (vkey, system_id, start_year, end_year, label) VALUES
          (12018013, 'btb', -714, -685, '~715–686 BC'), (42003001, 'btb', 26, 27, '~AD 26–27'),
          (1012001, 'btb', -2165, -1990, '~2166–1991 BC');
        """
    )
    rulers.ingest_rulers(ctx)
    finalize.run(ctx)
    con.commit()
    con.close()
    return path


def test_ingest_links_biblical_rulers_and_dates_reigns(built):
    con = db.connect(built, readonly=True)
    con.row_factory = None  # plain tuples
    try:
        assert (
            con.execute("SELECT person_id FROM office_holding WHERE id = 'hezekiah@judah'").fetchone()[0]
            == "hezekiah-1512"
        )
        # not in the (fixture) Theographic data: created as a ruler, with its verse
        assert con.execute("SELECT kind, floruit_from FROM person WHERE id = 'sargon-ii'").fetchone() == ("ruler", -721)
        assert con.execute("SELECT 1 FROM person_ref WHERE person_id = 'sargon-ii' AND vkey = 23020001").fetchone()
        assert con.execute("SELECT summary FROM person WHERE id = 'hezekiah-1512'").fetchone()[0] == "King of Judah"
        rows = con.execute(
            "SELECT aspect, system_id, start_year, end_year FROM dating WHERE entity_id = 'uzziah@judah' ORDER BY 1, 2"
        ).fetchall()
        assert ("coregency", "thiele", -791, -766) in rows
        assert ("reign", "thiele", -766, -739) in rows
        assert (
            con.execute(
                "SELECT value FROM external_id WHERE entity_id = 'hezekiah-1512' AND scheme = 'wikipedia'"
            ).fetchone()[0]
            == "Hezekiah"
        )
        assert con.execute("SELECT count(*) FROM period WHERE scope = 'realm'").fetchone()[0] >= 15
        assert con.execute("SELECT count(*) FROM office_holding WHERE id LIKE '%.2'").fetchone()[0] >= 4
    finally:
        con.close()


@pytest.fixture(scope="module")
def client(built):
    with TestClient(create_app(built, dist=built.parent / "no-dist")) as c:
        yield c


def test_rulers_endpoint(client):
    d = client.get("/api/rulers").json()
    realms = {r["id"]: r for r in d["realms"]}
    assert {"judah", "israel", "assyria", "rome", "high-priests"} <= set(realms)
    assert realms["judah"]["systems"][0] == "thiele"
    hez = next(r for r in realms["judah"]["rulers"] if r["id"] == "hezekiah@judah")
    assert hez["system"] == "thiele"
    assert hez["label"] == "716/15–687/86 BC"
    assert set(hez["dates"]) == {"thiele", "galil", "albright"}
    assert hez["verses"] == 1
    assert hez["first_osis"] == "2Kgs.18.13"
    assert {"thiele", "galil", "albright", "scholarly"} <= {s["id"] for s in d["systems"]}
    galil = client.get("/api/rulers", params={"system": "galil"}).json()
    hez = next(r for x in galil["realms"] if x["id"] == "judah" for r in x["rulers"] if r["id"] == "hezekiah@judah")
    assert (hez["system"], hez["start"]) == ("galil", -725)
    david = next(r for x in galil["realms"] if x["id"] == "united" for r in x["rulers"] if r["person_id"] == "david")
    assert david["system"] == "galil"


def test_who_ruled_in_a_year(client):
    names = lambda r: [x["name"] for x in r.json()["rulers"]]  # noqa: E731
    assert names(client.get("/api/rulers/at", params={"year": -700, "realm": "Judah"})) == ["Hezekiah"]
    assert "Sennacherib" in names(client.get("/api/rulers/at", params={"year": -700}))
    # 750 BC: Thiele has Uzziah with Jotham as coregent; Albright has Uzziah alone
    assert names(client.get("/api/rulers/at", params={"year": -749, "realm": "judah"})) == [
        "Uzziah (Azariah)",
        "Jotham",
    ]
    assert names(client.get("/api/rulers/at", params={"year": -749, "realm": "judah", "system": "albright"})) == [
        "Uzziah (Azariah)"
    ]
    assert client.get("/api/rulers/at", params={"year": -700, "realm": "Atlantis"}).status_code == 404


def test_rulers_at_the_time_of_a_verse(client):
    d = client.get("/api/verse/2Kgs.18.13/rulers").json()
    assert d["window"]["label"] == "~715–686 BC"
    first, second = d["rulers"][:2]
    assert (first["name"], first["realm_short"], first["system"], first["named"]) == (
        "Hezekiah",
        "Judah",
        "thiele",
        True,
    )
    assert second["name"] == "Sennacherib"
    luke = [r["name"] for r in client.get("/api/verse/Luke.3.1/rulers").json()["rulers"]]
    assert "Pontius Pilate" in luke
    assert "Tiberius" in luke
    assert "Herod Antipas" in luke
    assert "Caiaphas" not in luke  # high priests appear only when the chapter names them
    assert client.get("/api/verse/Gen.12.1/rulers").json()["rulers"] == []
    assert client.get("/api/verse/John.1.1/rulers").json() == {"osis": "John.1.1", "window": None, "rulers": []}


def test_person_reigns(client):
    d = client.get("/api/rulers/person/hezekiah-1512").json()
    assert [r["id"] for r in d["reigns"]] == ["hezekiah@judah"]
    assert d["reigns"][0]["realm_name"] == "Kingdom of Judah"
    two = client.get("/api/rulers/person/demetrius-ii").json()["reigns"]
    assert [r["id"] for r in two] == ["demetrius-ii@seleucid", "demetrius-ii@seleucid.2"]
    assert client.get("/api/rulers/person/nobody").json()["reigns"] == []


def test_the_rulers_tool(built):
    s = Store(built)
    text, err = agent_tools.run(s, "rulers", {"name": "Hezekiah"})
    assert not err
    assert "Thiele (1983): 716/15–687/86 BC" in text
    assert "Galil (1996): 726–697/96 BC" in text
    assert "/person/hezekiah-1512" in text
    text, _ = agent_tools.run(s, "rulers", {"name": "Pul"})
    assert "Tiglath-Pileser III" in text
    assert "745–727 BC" in text
    text, _ = agent_tools.run(s, "rulers", {"year": -701})
    assert "Rulers in 701 BC" in text
    assert "Hezekiah" in text
    assert "Sennacherib" in text
    text, _ = agent_tools.run(s, "rulers", {"year": -750, "realm": "Judah"})
    assert "chronologies differ" in text
    assert "Jotham" in text
    text, _ = agent_tools.run(s, "rulers", {"year": 30, "realm": "Judaea governors"})
    assert "Roman governors of Judaea: Pontius Pilate" in text
    assert "No realm" in agent_tools.run(s, "rulers", {"year": 30, "realm": "Atlantis"})[0]
    assert "Give a ruler's" in agent_tools.run(s, "rulers", {})[0]
    assert "No ruler named" in agent_tools.run(s, "rulers", {"name": "Zaphnath"})[0]
    assert agent_tools.validate("rulers", {"year": "701 BC"}) is not None


def test_realm_lookup_and_spans():
    realms = {
        "judah": rulers_api.Realm("judah", "Kingdom of Judah", "Judah", "King", "of", "local", 1, ["thiele"], None, None, None),
        "high-priests": rulers_api.Realm("high-priests", "High priests (Second Temple)", "the Temple", "High priest", "office",
                                         "named", 2, ["scholarly"], None, None, None),
    }  # fmt: skip
    assert rulers_api.realm_for(realms, "Judah") is realms["judah"]
    assert rulers_api.realm_for(realms, "high priests") is realms["high-priests"]
    assert rulers_api.realm_for(realms, "Babylon") is None
    assert rulers_api.span({"start": -766, "end": -739, "shared_from": -791}) == (-791, -739)
