"""Church history (curated dates, events) and the Jewish & Roman witnesses importers."""

from __future__ import annotations

import csv
import itertools
from pathlib import Path

import pytest

from testimonia import config
from testimonia.ingest import history, witnesses
from testimonia.refs import parse_refs

CURATED = Path(__file__).parent.parent / "curated"
RAW = config.RAW_DIR / "witnesses"


def rows(name: str) -> list[dict[str, str]]:
    with (CURATED / name).open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


# ----------------------------------------------------------------------------- curated tables


def test_people_are_unique_and_dated_consistently():
    people = rows("people.csv")
    ids = [p["id"] for p in people]
    assert len(ids) == len(set(ids))
    for p in people:
        born, died, f_from, f_to = (int(p[k]) if p[k] else None for k in ("born", "died", "floruit_from", "floruit_to"))
        assert any(v is not None for v in (born, died, f_from, f_to)), p["id"]
        if born is not None and died is not None:
            assert born < died, p["id"]
        if f_from is not None and f_to is not None:
            assert f_from <= f_to, p["id"]
        if died is not None and f_to is not None:
            assert f_to <= died, p["id"]
        assert set(p["approx"]) <= set("bdf"), p["id"]


def test_events_and_eras_are_ordered():
    for e in rows("events.csv"):
        start, end = int(e["start"]), int(e["end"] or e["start"])
        assert start <= end, e["id"]
        assert e["date_kind"] in ("point", "span", "window"), e["id"]
        assert e["date_kind"] != "point" or start == end, e["id"]
    eras = rows("church_eras.csv")
    for a, b in itertools.pairwise(eras[1:]):  # church eras (after the Second Temple band) are contiguous
        assert a["end"] == b["start"]


def test_work_dates_reference_known_authors():
    people = {p["id"] for p in rows("people.csv")}
    for w in rows("work_dates.csv"):
        assert int(w["date_from"]) <= int(w["date_to"]), w["work_id"]
        assert not w["author_id"] or w["author_id"] in people, w["work_id"]


def test_book_links_cover_every_book_once():
    from testimonia.books import BY_OSIS

    links = rows("book_links.csv")
    assert sorted(r["osis"] for r in links) == sorted(BY_OSIS)
    assert all(r["wikipedia"] for r in links)


def test_witness_links_parse_and_point_at_witness_works():
    ours = {
        "josephus.antiquities",
        "josephus.war",
        "tacitus.annals",
        "suetonius.lives",
        "pliny.letters",
        "lucian.peregrinus",
    }
    for link in rows("witness_links.csv"):
        assert link["work_id"] in ours
        assert parse_refs(link["ref"]), link["ref"]


@pytest.mark.parametrize(
    ("year", "era"),
    [
        (99, "apostolic"),
        (150, "ante-nicene"),
        (325, "nicene"),
        (600, "late-patristic"),
        (1274, "medieval"),
        (None, None),
    ],
)
def test_era_for(year, era):
    assert history.era_for(year) == era


# ----------------------------------------------------------------------------- plain-text helpers


def test_gutenberg_body_strips_header_and_footer(tmp_path):
    f = tmp_path / "pg.txt"
    f.write_text(
        "licence\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nbody\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nmore",
        "utf-8",
    )
    assert witnesses.gutenberg_body(f) == ["body"]
    f.write_text("no markers", "utf-8")
    with pytest.raises(witnesses.IngestError):
        witnesses.gutenberg_body(f)


@pytest.mark.parametrize(
    ("r", "n"), [("I", 1), ("IV", 4), ("IX", 9), ("XXV", 25), ("XLIX", 49), ("XCVII", 97), ("CXX", 120)]
)
def test_roman(r, n):
    assert witnesses._roman(r) == n


def test_clean_drops_markers_and_page_numbers():
    assert witnesses._clean("at the instigation of one Chrestus [528].  He") == "at the instigation of one Chrestus. He"
    assert witnesses._clean("a letter in Greek, (318) from the senate") == "a letter in Greek, from the senate"
    assert witnesses._para_html("a _man_ & #logos#") == "<p>a <i>man</i> &amp; logos</p>"


def test_pliny_maps_melmoth_numbers_to_modern(tmp_path):
    body = "\n".join(
        [
            "CORRESPONDENCE WITH THE EMPEROR TRAJAN",  # table of contents
            "XCVII To THE EMPEROR TRAJAN",
            "",
            "CORRESPONDENCE WITH THE EMPEROR TRAJAN",
            "",
            "XCVI -- TRAJAN TO PLINY",
            "",
            "Not this one.",
            "",
            "XCVII To THE EMPEROR TRAJAN[1066]",
            "",
            "It is my invariable rule, Sir, " + "to refer to you in all matters where I feel doubtful. " * 10,
            "",
            "XCVIII -- TRAJAN TO PLINY",
            "",
            "You have adopted the right course, my dearest Secundus. " * 8,
            "",
            "XCIX -- To THE EMPEROR TRAJAN",
            "",
            "Later letter.",
        ]
    )
    f = tmp_path / "pliny.txt"
    f.write_text(f"*** START OF X ***\n{body}\n*** END OF X ***\n", "utf-8")
    w = witnesses.pliny(f)
    assert [s.cite for s in w.sections] == ["10.96", "10.97"]
    assert w.sections[0].text.startswith("It is my invariable rule")
    assert "Later letter" not in w.sections[1].text


# ----------------------------------------------------------------------------- real files (when fetched)

needs_raw = pytest.mark.skipif(not (RAW / "josephus-whiston.xml").exists(), reason="witness sources not fetched")


@needs_raw
def test_josephus_real_structure():
    works = {w.id: w for w in witnesses.josephus(RAW / "josephus-whiston.xml")}
    assert set(works) == {"josephus.life", "josephus.antiquities", "josephus.war", "josephus.apion"}
    ant = {s.cite: s for s in works["josephus.antiquities"].sections}
    assert "Jesus, a wise man" in ant["18.3"].text
    assert "brother of Jesus, who was called Christ" in ant["20.9"].text
    assert "called the Baptist" in ant["18.5"].text
    assert ant["18.3"].title.startswith("Book 18, chapter 3.")
    assert len(works["josephus.war"].sections) > 100


@needs_raw
def test_tacitus_and_roman_witnesses_real():
    annals = {s.cite: s for s in witnesses.tacitus(RAW / "tacitus-annals-eng.xml")[0].sections}
    assert "Pontius Pilatus" in annals["15"].text
    suet = {s.cite: s for s in witnesses.suetonius(RAW / "suetonius-thomson-forester.txt").sections}
    assert "Chrestus" in suet["Claudius"].text
    assert "Christians" in suet["Nero"].text
    assert '<b class="cn">25</b>' in suet["Claudius"].html
    pliny = witnesses.pliny(RAW / "pliny-letters-melmoth.txt").sections
    assert all("Christians" in letter.text for letter in pliny)
    lucian = witnesses.lucian(RAW / "lucian-fowler-vol4.txt").sections[0]
    assert "crucified" in lucian.text
    assert "FOOTNOTES" not in lucian.text
