"""Places (OpenBible.info), people and events (Theographic): parsers, the ingest into core.db, and the API."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from testimonia import db
from testimonia.ingest import finalize, geography, theographic
from testimonia.ingest.base import Context
from testimonia.server.app import create_app
from testimonia.sources import load

# ----------------------------------------------------------------------------- OpenBible.info places

ANTIOCH = {
    "id": "ae41ab4",
    "friendly_id": "Antioch 1",
    "types": ["settlement"],
    "comment": 'in <ancient id="a890adf">Syria</ancient>; east of the river',
    "identifications": [
        {
            "score": {"time_total": 120, "vote_total": 30},
            "resolutions": [{"lonlat": "36.0,36.0", "lonlat_type": "center", "best_path_score": 30}],
        },
        {
            "score": {"time_total": 1000, "vote_total": 500},
            "resolutions": [{"lonlat": "36.171743,36.226691", "lonlat_type": "point", "best_path_score": 500}],
        },
    ],
    "modern_associations": {"mbe": {"name": "Antioch on the Orontes", "score": 1000}},
    "translation_name_counts": {"Antioch": 141, "Antioch of Syria": 5},
    "linked_data": {
        "s1": {"id": "658381", "url": "https://pleiades.stoa.org/places/658381"},
        "s2": {"id": "Q200441"},
        "s3": {"url": "https://en.wikipedia.org/wiki/Antioch_on_the_Orontes"},
        "s4": {"url": "https://en.wikipedia.org/wiki/Seleucid_Empire", "modifier": "partial"},
        "s5": {"url": "https://en.wikipedia.org/wiki/List_of_minor_biblical_places#Addan", "modifier": "anchor"},
    },
    "verses": [{"osis": "Acts.11.26"}, {"osis": "Gal.2.11"}, {"osis": "Nope.1.1"}],
}


def test_parse_place_takes_best_identification():
    p = geography.parse_place(ANTIOCH)
    assert p is not None
    assert (p.id, p.name, p.kind) == ("antioch-1", "Antioch", "city")
    assert (p.lat, p.lon, p.precision) == (36.226691, 36.171743, "exact")
    assert p.confidence == 1.0
    assert p.modern_name == "Antioch on the Orontes"
    assert p.summary == "in Syria; east of the river"
    assert p.alt_names == ["Antioch of Syria"]
    assert p.vkeys == [44011026, 48002011]
    assert p.external == [("pleiades", "658381"), ("wikidata", "Q200441"), ("wikipedia", "Antioch on the Orontes")]


def test_parse_place_unlocated_and_unnamed():
    rec = {
        "id": "a1",
        "friendly_id": "Ophir",
        "types": ["special"],
        "comment": "region",
        "identifications": [{"score": {"time_total": 1000}, "resolutions": [{"type": "unknown_place"}]}],
        "verses": [{"osis": "1Kgs.9.28"}],
    }
    p = geography.parse_place(rec)
    assert p is not None
    assert (p.lat, p.lon, p.precision, p.kind, p.summary) == (None, None, "unknown", "other", None)
    assert geography.parse_place({**rec, "verses": []}) is None


def test_slugify():
    assert geography.slugify("Abel-beth-maacah") == "abel-beth-maacah"
    assert geography.slugify("Jacob's Well") == "jacobs-well"
    assert geography.slugify("Mary (Mother of Jesus)") == "mary-mother-of-jesus"


# ----------------------------------------------------------------------------- Theographic helpers


def test_ranges_years_and_durations():
    assert theographic.ranges([1001003, 1001001, 1001002, 1002001]) == [(1001001, 1001003), (1002001, 1002001)]
    assert theographic.parse_year("-4003") == (-4003, None, None)
    assert theographic.parse_year("0030-04-04") == (30, 4, 4)
    assert theographic.parse_year("soon") is None
    assert theographic.span_end(-1744, "110Y") == -1634
    assert theographic.span_end(30, "18M") == 31
    assert theographic.span_end(30, "7D") == 30


def test_easton_and_summaries():
    html = theographic.easton_html("Son of [Jesse](/1sam#1Sam.16.1) <b>x</b>.\n\nSee [Ruth 4:17](/ruth#Ruth.4.17).")
    assert '<a data-ref="1Sam.16.1">Jesse</a>' in html
    assert "&lt;b&gt;" in html
    assert html.count("<p>") == 2
    text = "The eldest son of Amram and Jochebed ([Ex. 6:20](/exod#Exod.6.20)). Some explain the name."
    assert theographic.first_sentence(text) == "The eldest son of Amram and Jochebed."
    assert theographic.first_sentence("Drawn. Of the tribe of Levi.") is None
    assert theographic.person_name({"name": "Mary", "displayTitle": "Mary (Mother of Jesus)"}) == (
        "Mary",
        "Mother of Jesus",
    )


def test_easton_keeps_only_the_part_about_this_person():
    br = theographic.PARAGRAPH_BREAK
    lots = f"A small stone used in casting lots ([Num. 33:54](/num#Num.33.54)).{br}The lot decided ([Jonah 1:7](/jonah#Jonah.1.7))."
    man = f"The son of Haran ([Gen. 11:27](/gen#Gen.11.27)).{br}He chose the plain."
    assert theographic.easton_for(f"{lots}{br}{man}", [1011027, 1013005], "Lot") == man  # Lot, Abraham's nephew
    assert theographic.easton_for(lots, [1011027], "Lot") == ""
    assert theographic.easton_for(lots, [4033054], "Lot") == lots
    assert theographic.easton_for("An entry without references.", [1], "Lot") == "An entry without references."


def test_preferred_slugs_avoid_ambiguous_names():
    rows = [
        {"personLookup": "jesus_904", "name": "Jesus", "displayTitle": "Jesus"},
        {"personLookup": "jesus_905", "name": "Jesus", "displayTitle": "Jesus Christ"},
        {"personLookup": "abdi_6", "name": "Abdi", "displayTitle": "Abdi"},
        {"personLookup": "abdi_7", "name": "Abdi", "displayTitle": "Abdi"},
        {"personLookup": "david_994", "name": "David", "displayTitle": "David"},
    ]
    pref = theographic.preferred_slugs(rows, "personLookup")
    assert pref == {"jesus_904": "", "jesus_905": "jesus-christ", "abdi_6": "", "abdi_7": "", "david_994": "david"}
    ids = theographic.assign_ids([(k, v, k.replace("_", "-")) for k, v in pref.items()], reserved={"david"})
    assert ids["david_994"] == "david-994"  # a church-history person already has the id
    assert ids["jesus_905"] == "jesus-christ"


# ----------------------------------------------------------------------------- ingest into a core database

PEOPLE = [
    {"personLookup": "jesse_903", "personID": "903", "name": "Jesse", "displayTitle": "Jesse", "gender": "Male",
     "verses": "Ruth.4.17", "children": "david_994", "dictText": "Strong, the son of Obed and father of David ([Ruth 4:17](/ruth#Ruth.4.17))."},
    {"personLookup": "david_994", "personID": "994", "name": "David", "displayTitle": "David", "gender": "Male",
     "verses": "Ruth.4.17,1Sam.16.13", "father": "jesse_903", "partners": "michal_2073", "birthYear": "-1084",
     "deathYear": "-1014", "deathPlace": "jerusalem_636", "memberOf": "Tribe of Judah", "chaptersWritten": "Ps.3,Ps.4"},
    {"personLookup": "michal_2073", "personID": "2073", "name": "Michal", "displayTitle": "Michal", "gender": "Female",
     "verses": "1Sam.18.20", "partners": "david_994"},
]  # fmt: skip
PLACES = [
    {"placeLookup": "jerusalem_636", "placeID": "636", "displayTitle": "Jerusalem", "kjvName": "Jerusalem",
     "verses": "1Sam.17.54", "dictText": "Called also Salem ([Gen. 14:18](/gen#Gen.14.18)).", "comment": ""},
    {"placeLookup": "salem_1047", "placeID": "1047", "displayTitle": "Salem", "kjvName": "Salem", "verses": "Gen.14.18",
     "canonicalPlace": "jerusalem_636", "comment": "Same as Jerusalem"},
    {"placeLookup": "naioth_870", "placeID": "870", "displayTitle": "Naioth", "kjvName": "Naioth", "verses": "1Sam.19.18",
     "latitude": "31.85", "longitude": "35.2", "featureType": "City"},
]  # fmt: skip
EVENTS = [
    {"title": "David anointed", "eventID": "300", "startDate": "-1063", "duration": "1D", "verses": "1Sam.16.12,1Sam.16.13",
     "participants": "david_994,jesse_903", "locations": "jerusalem_636"},
    {"title": "Reign of David", "eventID": "301", "startDate": "-1055", "duration": "40Y", "verses": "2Sam.5.4",
     "participants": "david_994", "predecessor": "David anointed"},
]  # fmt: skip
GAZETTEER = {
    "features": [
        {
            "links": [
                {"identifier": "https://theographic.netlify.app/place/jerusalem_636/"},
                {"identifier": "https://www.openbible.info/geo/ancient/a1"},
                {"identifier": "https://www.wikidata.org/wiki/Q1218"},
            ],
            "names": [],
        }
    ]
}
JOURNEYS = {
    "features": [
        {"type": "Feature", "properties": {"route_id": 1}, "geometry": {"type": "LineString", "coordinates": [[35.2, 31.8], [36.2, 36.2]]}},
        {"type": "Feature", "properties": {"Place Name": "Jerusalem", "first": "Acts.13.3-4, Acts.14.26"}, "geometry": {"type": "Point", "coordinates": [35.23, 31.78]}},
        {"type": "Feature", "properties": {"Place Name": "Nowhere", "first": "Acts.13.1"}, "geometry": {"type": "Point", "coordinates": [30, 30]}},
        {"type": "Feature", "properties": {"Place Name": "Three Taverns", "first": "924"}, "geometry": {"type": "Point", "coordinates": [12.8, 41.6]}},
    ]
}  # fmt: skip


@pytest.fixture
def core(tmp_path):
    con = db.create_core(tmp_path / "core.db")
    con.executescript(
        """
        INSERT INTO source (id, name, license) VALUES ('openbible-geo', 'OpenBible', 'CC-BY-4.0'),
          ('theographic', 'Theographic', 'CC-BY-SA-4.0'), ('t', 'test', 'PD');
        INSERT INTO chronology_system (id, name) VALUES ('jones', 'Floyd Nolen Jones (1993)');
        INSERT INTO person (id, name, kind, source_id) VALUES ('jesse', 'Jesse (a church writer)', 'father', 't');
        """
    )
    jerusalem = geography.Place(
        "jerusalem", "a1", "Jerusalem", "city", 31.7767, 35.2342, "exact", 1.0, None, None, [], [9017054]
    )
    geography.write_places(Context(con=con, manifest=load()), [jerusalem], "openbible-geo")
    yield con
    con.close()


def test_theographic_ingest(core):
    ctx = Context(con=core, manifest=load())
    core.row_factory = None  # plain tuples
    places = theographic.link_places(ctx, PLACES, GAZETTEER)
    assert places == {"jerusalem_636": "jerusalem", "salem_1047": "jerusalem", "naioth_870": "naioth"}
    assert core.execute("SELECT lat, source_id FROM place WHERE id = 'naioth'").fetchone() == (31.85, "theographic")
    assert (
        core.execute("SELECT count(*) FROM place_ref WHERE place_id = 'jerusalem'").fetchone()[0] == 2
    )  # 1 Sam 17:54 (both), Gen 14:18 (Salem)
    assert ("wikidata", "Q1218") in core.execute(
        "SELECT scheme, value FROM external_id WHERE entity_id = 'jerusalem'"
    ).fetchall()

    people = theographic.ingest_people(ctx, PEOPLE, places)
    assert people == {"jesse_903": "jesse-903", "david_994": "david", "michal_2073": "michal"}  # 'jesse' is taken
    rels = set(core.execute("SELECT person_a, relation, person_b FROM person_relation").fetchall())
    assert rels == {("jesse-903", "father_of", "david"), ("david", "spouse_of", "michal")}
    assert core.execute("SELECT born, died, kind FROM person WHERE id = 'david'").fetchone() == (
        -1084,
        -1014,
        "biblical",
    )
    assert (
        core.execute("SELECT summary FROM person WHERE id = 'jesse-903'").fetchone()[0]
        == "Strong, the son of Obed and father of David."
    )
    attrs = dict(core.execute("SELECT key, value FROM entity_attr WHERE uri = 'person:david'").fetchall())
    assert json.loads(attrs["bio.wrote"]) == ["Ps"]
    assert (
        core.execute("SELECT dst FROM entity_link WHERE src = 'person:david' AND rel = 'died_at'").fetchone()[0]
        == "place:jerusalem"
    )

    assert theographic.ingest_events(ctx, EVENTS, people, places) == 2
    assert core.execute("SELECT place_id FROM event WHERE id = 'david-anointed'").fetchone()[0] == "jerusalem"
    assert core.execute("SELECT start_vkey, end_vkey FROM event_ref WHERE event_id = 'david-anointed'").fetchall() == [
        (9016012, 9016013)
    ]
    reign = core.execute(
        "SELECT date_kind, start_year, end_year FROM dating WHERE entity_id = 'reign-of-david'"
    ).fetchone()
    assert reign == ("span", -1055, -1015)
    assert core.execute(
        "SELECT dst FROM entity_link WHERE src = 'event:reign-of-david' AND rel = 'follows'"
    ).fetchone()[0] == ("event:david-anointed")

    assert theographic.ingest_journeys(ctx, JOURNEYS) == 1
    feature = json.loads(core.execute("SELECT geojson FROM geo_feature WHERE id = 'paul-journey-1'").fetchone()[0])
    assert [s["name"] for s in feature["properties"]["stops"]] == ["Nowhere", "Jerusalem"]  # in verse order
    assert feature["properties"]["stops"][1]["place"] == "jerusalem"
    assert feature["properties"]["stops"][1]["osis"] == "Acts.13.3"


def test_first_ref_of_a_stop():
    assert theographic.first_ref("Acts.13.1,Acts.14.26") == "Acts.13.1"
    assert theographic.first_ref("Acts.13.13, Acts.14.24") == "Acts.13.13"
    assert theographic.first_ref("Acts.17.15-16") == "Acts.17.15"
    assert theographic.first_ref(" Acts.28.16 ") == "Acts.28.16"
    assert theographic.first_ref("924") is None
    assert theographic.first_ref("") is None


# ----------------------------------------------------------------------------- API

FIXTURE = """
INSERT INTO source (id, name, license) VALUES ('t', 'test', 'PD'), ('theographic', 'Theographic', 'CC-BY-SA-4.0');
INSERT INTO book (osis, ord, name, testament, chapters) VALUES ('Gen', 1, 'Genesis', 'OT', 50), ('Acts', 44, 'Acts', 'NT', 28);
INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (1012008, 'Gen.12.8', 'Gen', 12, 8), (44011026, 'Acts.11.26', 'Acts', 11, 26);
INSERT INTO edition (id, title, abbrev, language, kind, sort, source_id) VALUES ('kjva', 'King James', 'KJV', 'eng', 'translation', 1, 't');
INSERT INTO edition_verse (edition_id, vkey, text) VALUES ('kjva', 1012008, 'And he removed from thence unto a mountain on the east of Bethel'),
  ('kjva', 44011026, 'And the disciples were called Christians first in Antioch.');
INSERT INTO chronology_system (id, name) VALUES ('jones', 'Floyd Nolen Jones (1993)'), ('scholarly', 'Scholarly consensus');
INSERT INTO place (id, name, kind, lat, lon, precision, modern_name, source_id) VALUES
  ('bethel-1', 'Bethel', 'city', 31.93, 35.22, 'exact', 'Beitin', 't'), ('ai-1', 'Ai', 'city', 31.92, 35.26, 'exact', NULL, 't'),
  ('antioch-1', 'Antioch', 'city', 36.2, 36.16, 'exact', NULL, 't'), ('ophir', 'Ophir', 'region', NULL, NULL, 'unknown', NULL, 't');
INSERT INTO place_ref (place_id, vkey) VALUES ('bethel-1', 1012008), ('ai-1', 1012008), ('antioch-1', 44011026);
INSERT INTO entity_attr (uri, key, value, confidence, source_id) VALUES ('place:bethel-1', 'geo.confidence', '0.9', 0.9, 't'),
  ('place:ai-1', 'geo.confidence', '0.3', 0.3, 't');
INSERT INTO external_id (entity_type, entity_id, scheme, value) VALUES ('place', 'bethel-1', 'pleiades', '687916');
INSERT INTO person (id, name, kind, summary, source_id) VALUES ('abraham', 'Abraham', 'biblical', 'Father of a multitude', 'theographic'),
  ('terah', 'Terah', 'biblical', NULL, 'theographic'), ('irenaeus', 'Irenaeus', 'father', NULL, 't');
INSERT INTO person_ref (person_id, vkey) VALUES ('abraham', 1012008);
INSERT INTO person_relation (person_a, relation, person_b, source_id) VALUES ('terah', 'father_of', 'abraham', 'theographic');
INSERT INTO event (id, title, kind, place_id, source_id) VALUES ('abram-builds-an-altar', 'Abram builds an altar', 'biblical', 'bethel-1', 'theographic'),
  ('destruction-of-temple', 'Destruction of the Second Temple', 'political', NULL, 't');
INSERT INTO event_ref (event_id, start_vkey, end_vkey) VALUES ('abram-builds-an-altar', 1012008, 1012008);
INSERT INTO event_participant (event_id, person_id) VALUES ('abram-builds-an-altar', 'abraham');
INSERT INTO entity_link (src, rel, dst, source_id) VALUES ('event:abram-builds-an-altar', 'located_at', 'place:bethel-1', 'theographic'),
  ('person:abraham', 'visited', 'place:bethel-1', 'theographic');
INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, source_id) VALUES
  ('event', 'abram-builds-an-altar', 'when', 'jones', 'point', -1920, -1920, 'theographic'),
  ('event', 'destruction-of-temple', 'when', 'scholarly', 'point', 70, 70, 't');
INSERT INTO geo_feature (id, kind, name, geojson, source_id) VALUES ('paul-journey-1', 'route', 'First journey',
  '{"type":"Feature","geometry":{"type":"MultiLineString","coordinates":[[[36.16,36.2],[33.9,35.1]]]},"properties":{"journey":1,"stops":[{"name":"Antioch","osis":"Acts.13.1","lat":36.2,"lon":36.16,"place":"antioch-1"}]}}',
  'theographic');
"""


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("geo") / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE)
    finalize.run(Context(con=con, manifest=load()))
    con.close()
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_atlas(client):
    a = client.get("/api/atlas").json()
    places = {p["id"]: p for p in a["places"]}
    assert set(places) == {"bethel-1", "ai-1", "antioch-1"}  # Ophir has no coordinates
    assert places["bethel-1"]["confidence"] == 0.9
    assert places["bethel-1"]["books"] == [1]
    assert places["antioch-1"]["verses"] == 1
    assert [r["id"] for r in a["routes"]] == ["paul-journey-1"]
    routes = client.get("/api/atlas/routes").json()
    assert routes[0]["geojson"]["properties"]["stops"][0]["place"] == "antioch-1"


def test_place_page(client):
    r = client.get("/api/place/bethel-1").json()
    assert r["place"]["confidence"] == 0.9
    assert r["place"]["external"] == {"pleiades": "687916"}
    assert r["verses"]["count"] == 1
    assert r["verses"]["books"] == [{"book": "Gen", "name": "Genesis", "testament": "OT", "refs": ["12.8"]}]
    assert r["verses"]["samples"][0]["text"].startswith("And he removed")
    assert [e["id"] for e in r["events"]] == ["abram-builds-an-altar"]
    assert r["events"][0]["year"] == -1920
    assert {p["id"]: p["roles"] for p in r["people"]} == {"abraham": ["event", "visited"]}
    assert [n["id"] for n in r["nearby"]] == ["ai-1"]
    assert client.get("/api/place/antioch-1").json()["routes"] == ["paul-journey-1"]
    assert client.get("/api/place/nowhere").status_code == 404


def test_person_page(client):
    r = client.get("/api/person/abraham").json()
    assert r["person"]["kind"] == "biblical"
    assert [p["id"] for p in r["family"]["parents"]] == ["terah"]
    assert [p["id"] for p in client.get("/api/person/terah").json()["family"]["children"]] == ["abraham"]
    assert [e["id"] for e in r["events"]] == ["abram-builds-an-altar"]
    assert r["places"][0]["id"] == "bethel-1"
    assert r["verses"]["count"] == 1
    assert client.get("/api/person/irenaeus").json()["person"]["kind"] == "father"


def test_event_page(client):
    r = client.get("/api/event/abram-builds-an-altar").json()
    assert r["event"]["dating"][0]["system_id"] == "jones"
    assert [p["id"] for p in r["people"]] == ["abraham"]
    assert [p["id"] for p in r["places"]] == ["bethel-1"]
    assert r["refs"][0]["osis"] == "Gen.12.8"
    assert r["passage"][0]["text"].startswith("And he removed")
    assert client.get("/api/event/destruction-of-temple").json()["event"]["dating"][0]["start_year"] == 70


def test_verse_entities(client):
    r = client.get("/api/verse/Gen.12.8/entities").json()
    assert [p["id"] for p in r["people"]] == ["abraham"]
    assert [p["id"] for p in r["places"]] == ["ai-1", "bethel-1"]
    assert [e["id"] for e in r["events"]] == ["abram-builds-an-altar"]
    assert client.get("/api/verse/Gen.99.1/entities").json()["people"] == []
    assert client.get("/api/verse/Nope.1.1/entities").status_code == 404


def test_timeline_leaves_out_biblical_events(client):
    events = [e["id"] for e in client.get("/api/timeline").json()["events"]]
    assert events == ["destruction-of-temple"]
