"""Manuscripts: wikitext parsing, dates, contents → verse ranges, the ingest steps and the API (small saved excerpts)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_api import FIXTURE

from testimonia import db
from testimonia.ingest import finalize, manuscripts
from testimonia.ingest.base import Context
from testimonia.ingest.manuscripts import coverage, parse_date, plain, scripts, tables
from testimonia.refs import key_to_parts, parse_refs
from testimonia.server.app import create_app
from testimonia.server.manuscripts import _span_label, ntvmr_doc_id, ntvmr_verse_url
from testimonia.sources import load

FIXTURES = Path(__file__).parent / "fixtures" / "manuscripts"


def osis(k: int) -> str:
    b, c, v = key_to_parts(k)
    return f"{b}.{c}.{v}"


def spans(text: str, **kw: bool) -> list[tuple[str, str]]:
    return [(osis(a), osis(b)) for a, b in coverage(text, **kw).ranges]


# ----------------------------------------------------------------------------- wikitext


def test_plain_text_from_wikitext():
    assert plain("{{Papyrus link|52}}") == "𝔓⁵²"
    assert plain("{{Papyrus link|52}}", sup=False) == "P52"
    assert plain("[[Isaiah Scroll|1QIsa{{sup|a}}]]") == "1QIsaᵃ"
    assert plain("D<sup>ea</sup>") == "Dᵉᵃ"
    assert plain("[[British Library|BL]], Add. 43725", expand=True) == "British Library, Add. 43725"
    assert plain("'''[[Minuscule 1739|1739]]'''") == "1739"
    assert plain("a [http://x.org label] b{{sfn|Fitzmyer|2008}}") == "a label b"


def test_tables_expand_rowspans_and_empty_attributes():
    text = manuscripts.clean_source((FIXTURES / "nt-papyri.wiki").read_text(encoding="utf-8"))
    (t,) = tables(text)
    assert t.heading == "Papyrus 1–50"
    assert t.header[:3] == ["name", "date", "content"]
    p46 = [r for r in t.rows if "46" in r["name"]]
    assert len(p46) == 2  # two libraries hold parts of P46; the second row inherits name and date
    assert p46[1]["date"] == "175-225"
    assert plain(p46[1]["institution"]) == "University of Michigan"


# ----------------------------------------------------------------------------- dates


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("110-140", (110, 140)),
        ("~250", (250, 250)),
        ("4th", (301, 400)),
        ("5th/6th", (401, 600)),
        ("III/IV", (201, 400)),
        ("c. 950", (950, 950)),
        ("1285-6", (1285, 1286)),
        ("1st century BCE", (-99, 0)),
        ("Later half of the 1st century BC", (-49, 0)),
        ("25 BCE–50 CE", (-24, 50)),
        ("356–103 BCE/150–100 BCE", (-355, -99)),
        ("Herodian", (-29, 68)),
        ("Hasmonean/Herodian", (-149, 68)),
        ("20–84 AD Roman", (20, 84)),  # explicit years win over the script period
    ],
)
def test_parse_date(label, expected):
    d = parse_date(label)
    assert d is not None
    assert (d.lo, d.hi) == expected


def test_undated_labels_and_scripts():
    assert parse_date("") is None
    assert parse_date("Paleo-Hebrew script") is None
    assert scripts("Hellenistic-Roman; Palaeo-Hebrew script") == "Hellenistic-Roman, Paleo-Hebrew"
    assert parse_date("Herodian").circa  # type: ignore[union-attr]


# ----------------------------------------------------------------------------- contents → verse ranges


def test_coverage_whole_books_and_lacunae():
    assert spans("Gospels†, Acts†") == [("Matt.1.1", "John.999.999"), ("Acts.1.1", "Acts.999.999")]
    assert coverage("Gospels†").partial
    assert not coverage("Revelation").partial
    vat = spans("Gospels, Acts, General Epistles, Pauline Epistles† (lacking 1 Timothy–Philemon)")
    assert ("Rom.1.1", "2Thess.999.999") in vat  # Romans … 2 Thessalonians, then Hebrews: the Pastorals are lacking
    assert ("Heb.1.1", "Heb.999.999") in vat
    assert all(not a.startswith(("1Tim", "2Tim", "Titus", "Phlm")) for a, _ in vat)
    assert spans("James - 3 John") == [("Jas.1.1", "3John.999.999")]


def test_coverage_references():
    assert spans("John 18:31-33, 18:37-38") == [("John.18.31", "John.18.33"), ("John.18.37", "John.18.38")]
    assert spans("Hebrews 9:26–end") == [("Heb.9.26", "Heb.13.999")]
    assert spans("John 1:1-5:3a") == [("John.1.1", "John.5.3")]
    assert spans("John (7:6-9:23)†") == [("John.7.6", "John.9.23")]  # not the whole of John
    assert spans("contains Gen 46:28 to Heb 9:14") == [("Gen.46.28", "Heb.9.14")]
    assert spans("Gospels Diatessaron") == []  # a harmony is not a copy of the Gospels
    assert spans("The Book of Isaiah", books_only=False) == []  # a scroll named after a book: no verses claimed


def test_refs_continuation_crossing_a_chapter():
    (a, b, c) = parse_refs("Genesis 34:5–7, 30–35:1, 4–7")
    assert (b.start_id, b.c2, b.v2) == ("Gen.34.30", 35, 1)
    assert c.start_id == "Gen.35.4"
    assert a.start_id == "Gen.34.5"
    # after a range that ends in another chapter, bare verses continue that chapter (P66: 'John 8:12-14:26, 29-30')
    (_, d, e) = parse_refs("John 8:12-14:26, 29-30, 15:2")
    assert (d.start_id, d.c2, d.v2) == ("John.14.29", 14, 30)
    assert e.start_id == "John.15.2"


def test_parts_of_one_manuscript_add_up():
    assert manuscripts._add_extent("56 leaves", "30 leaves") == "86 leaves"
    assert manuscripts._add_extent("78 leaves, 1 fragment", "2 fragments") == "78 leaves, 3 fragments"
    assert manuscripts._add_extent("1 leaf", None) == "1 leaf"
    assert manuscripts._add_extent("11 columns", "2 fragments") == "11 columns; 2 fragments"
    assert manuscripts._join("Chester Beatty Library (Dublin); Bodmer", "Chester Beatty Library (Dublin)") == (
        "Chester Beatty Library (Dublin); Bodmer"
    )


# ----------------------------------------------------------------------------- steps + API


class FixtureContext(Context):
    def paths(self, source_id: str) -> list[Path]:
        names = {
            manuscripts.SOURCE: [
                "nt-papyri.wiki",
                "nt-uncials.wiki",
                "nt-minuscules-1701.wiki",
                "lxx-manuscripts.wiki",
            ],
            manuscripts.DSS_SOURCE: ["dead-sea-scrolls.wiki"],
        }[source_id]
        return [FIXTURES / n for n in names]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    path = tmp_path_factory.mktemp("ms") / "core.db"
    con = db.create_core(path)
    con.executescript(FIXTURE)
    ctx = FixtureContext(con=con, manifest=load())
    mp = pytest.MonkeyPatch()
    mp.setattr(manuscripts, "MIN_PAPYRI", 1)
    mp.setattr(manuscripts, "MIN_SCROLLS", 1)
    for source in (manuscripts.SOURCE, manuscripts.DSS_SOURCE, "stepbible-tahot"):
        ctx.register(source)
    # Hebrew verse numbering, as stepbible-tahot stores it: Isaiah 8:23–9:20 (Hebrew) is 9:1–21 (English)
    con.execute(
        "INSERT OR IGNORE INTO edition (id, title, language, script_dir, kind, source_id) "
        "VALUES ('wlc', 'Westminster Leningrad Codex', 'hbo', 'rtl', 'reading_text', 'stepbible-tahot')"
    )
    con.executemany(
        "INSERT OR REPLACE INTO edition_verse (edition_id, vkey, native_ref, text) VALUES ('wlc', ?, ?, '')",
        [(23_009_001, "Isa.8.23")] + [(23_009_001 + v, f"Isa.9.{v}") for v in range(1, 21)],
    )
    manuscripts.ingest_manuscripts(ctx)
    manuscripts.ingest_dss(ctx)
    manuscripts.ingest_dss(ctx)  # steps are re-runnable
    mp.undo()
    finalize.run(ctx)
    con.commit()
    yield path, con
    con.close()


def test_ingest_rows(built):
    _, con = built
    ids = {r[0] for r in con.execute("SELECT id FROM manuscript")}
    assert {"GA:P1", "GA:P46", "GA:P52", "GA:01", "GA:03", "GA:046", "GA:0212", "GA:1739"} <= ids
    assert "GA:1740" not in ids  # minuscules without their own article are left out
    assert "LXX:B" not in ids  # merged into GA:03
    assert "LXX:801" not in ids  # Qumran Greek scroll: from the DSS list
    assert "LXX:13" not in ids  # numbered witness after AD 600
    assert "LXX:729" not in ids  # withdrawn number
    assert {"LXX:W", "LXX:846", "DSS:1QIsaa", "DSS:1QS", "DSS:4QGenb", "DSS:4QGenb-4Q2a"} <= ids
    p46 = con.execute(
        "SELECT institution, date_from, date_to, description FROM manuscript WHERE id = 'GA:P46'"
    ).fetchone()
    assert tuple(p46) == (
        "Chester Beatty Library (Dublin); University of Michigan (Ann Arbor)",
        175,
        225,
        "86 leaves",
    )
    vat = [
        tuple(r)
        for r in con.execute("SELECT start_vkey, end_vkey FROM manuscript_coverage WHERE manuscript_id = 'GA:03'")
    ]
    assert any(a <= 1_046_028 <= b for a, b in vat)  # Gen 46:28, from the Septuagint list
    assert not any(a <= 54_001_001 <= b for a, b in vat)  # 1 Timothy is lacking
    when = con.execute(
        "SELECT date_kind, start_year, end_year, basis FROM dating WHERE entity_id = 'DSS:4QGenb'"
    ).fetchone()
    assert tuple(when) == ("window", -62, 135, "palaeography")
    ext = dict(con.execute("SELECT scheme, value FROM external_id WHERE entity_id = 'GA:03'").fetchall())
    assert ext == {"ga": "03", "rahlfs": "B", "wikipedia": "Codex Vaticanus"}
    leon = con.execute("SELECT image_url FROM manuscript WHERE id = 'DSS:4QGenb'").fetchone()[0]
    assert leon.endswith("/4Q2-1")
    assert con.execute("SELECT count(*) FROM manuscript WHERE source_id = 'wikipedia-dss'").fetchone()[0] == 4


def test_hebrew_verse_numbers_move_to_the_hub():
    table = manuscripts.hebrew_map(
        [(23_009_001, "Isa.8.23")] + [(23_009_001 + v, f"Isa.9.{v}") for v in range(1, 21)] + [(19_003_000, "Ps.3.1")]
    )
    # 'Isaiah 1:1–8:23; 9:1–20' in Hebrew numbers is Isaiah 1:1–9:21 in English, one unbroken range
    assert manuscripts.to_hub([(23_001_001, 23_008_023), (23_009_001, 23_009_020)], table) == [(23_001_001, 23_009_021)]
    assert manuscripts.to_hub([(23_010_001, 23_066_024)], table) == [(23_010_001, 23_066_024)]  # numbered alike
    assert manuscripts.to_hub([(19_003_001, 19_003_001)], table) == [(19_003_000, 19_003_000)]  # a Psalm title
    split = manuscripts.hebrew_map([(1_031_055, "Gen.32.1"), (1_032_001, "Gen.32.1")])  # one verse, two hub verses
    assert manuscripts.to_hub([(1_032_001, 1_032_001)], split) == [(1_031_055, 1_032_001)]


def test_scroll_coverage_uses_english_numbers(built):
    _, con = built
    ranges = con.execute(
        "SELECT start_vkey, end_vkey FROM manuscript_coverage WHERE manuscript_id = 'DSS:1QIsaa'"
    ).fetchall()
    assert ranges
    assert not any(b == 23_008_023 for _, b in ranges)  # Hebrew 8:23 does not exist in the English numbering
    assert any(a <= 23_009_021 <= b for a, b in ranges)  # English 9:21 (Hebrew 9:20) is covered


@pytest.fixture(scope="module")
def client(built):
    path, _ = built
    with TestClient(create_app(path, dist=path.parent / "no-dist")) as c:
        yield c


def test_api_catalogue_and_page(client):
    data = client.get("/api/manuscripts").json()
    first = data["manuscripts"][0]
    assert first["id"] == "DSS:1QIsaa"  # earliest first
    assert {c["collection"] for c in data["collections"]} >= {"NT papyri", "Dead Sea Scrolls", "LXX manuscripts"}
    page = client.get("/api/manuscript/GA:P52").json()
    assert page["manuscript"]["institution"] == "John Rylands University Library"
    assert page["passages"][0] == {
        "osis": "John.18.31",
        "label": "John 18:31–33",
        "testament": "NT",
        "completeness": "fragmentary",
    }
    assert page["ntvmr"]["images"] == "https://ntvmr.uni-muenster.de/manuscript-workspace?docID=10052"
    assert page["wikipedia"] == "Papyrus 52"
    assert page["dating"][0]["start_year"] == 110
    assert client.get("/api/manuscript/GA:nope").status_code == 404


def test_api_verse_manuscripts(client):
    v = client.get("/api/verse/John.1.18/manuscripts").json()
    assert [m["id"] for m in v["manuscripts"]] == ["GA:01", "GA:03"]
    assert v["ntvmr_verse"] == "https://ntvmr.uni-muenster.de/liste?indexContent=John.1.18"
    g = client.get("/api/verse/Gen.1.1/manuscripts").json()
    assert [s["id"] for s in g["dss"]] == ["DSS:4QGenb"]
    assert g["ntvmr_verse"] is None
    assert client.get("/api/verse/Nope.1.1/manuscripts").status_code == 404


def test_ntvmr_ids_and_labels():
    assert [ntvmr_doc_id(x) for x in ("P52", "01", "046", "0212", "1739", "L1")] == [
        10052,
        20001,
        20046,
        20212,
        31739,
        None,
    ]
    assert ntvmr_verse_url(43_018_031) == "https://ntvmr.uni-muenster.de/liste?indexContent=John.18.31"
    assert _span_label(43_001_001, 43_999_999) == "John"
    assert _span_label(58_009_026, 58_013_999) == "Hebrews 9:26–13"
    assert _span_label(1_046_028, 39_999_999) == "Genesis 46:28 – Malachi"
