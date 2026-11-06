"""Church-father importers: commentary file names, CCEL work classification and ThML → HTML."""

from __future__ import annotations

import pytest
from lxml import etree

from testimonia.ingest import ccel, hcf

# ----------------------------------------------------------------------------- Commentaries-Database


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("John 1_18.toml", ("John", 43_001_018, 43_001_018)),
        ("Isaiah 28_11-12.toml", ("Isa", 23_028_011, 23_028_012)),
        ("Genesis 1_1-2_3.toml", ("Gen", 1_001_001, 1_002_003)),
        ("1 Corinthians 13_4.toml", ("1Cor", 46_013_004, 46_013_004)),
        ("2 Maccabees 12_39-45.toml", ("2Macc", 78_012_039, 78_012_045)),
    ],
)
def test_hcf_parse_filename(name, expected):
    vf = hcf.parse_filename(name)
    assert vf is not None
    assert (vf.book, vf.start, vf.end) == expected


@pytest.mark.parametrize("name", ["metadata.toml", "Nowhere 1_1.toml", "John 2_5-1.toml", "John.toml"])
def test_hcf_rejects_bad_filenames(name):
    assert hcf.parse_filename(name) is None


def test_hcf_quote_html_escapes_and_splits_paragraphs():
    assert hcf.quote_html("A <b> & c\n\nSecond   para") == "<p>A &lt;b&gt; &amp; c</p><p>Second para</p>"


@pytest.mark.parametrize(
    ("year", "era"),
    [
        (110, "apostolic"),
        (202, "ante-nicene"),
        (325, "ante-nicene"),
        (407, "nicene"),
        (600, "late-patristic"),
        (1274, "medieval"),
        (1564, "reformation"),
        (1850, "modern"),
        (None, None),
    ],
)
def test_era_for(year, era):
    assert hcf.era_for(year) == era
    assert ccel.era_for(year) == era


# ----------------------------------------------------------------------------- CCEL classification

ANF_LIKE = (
    """<ThML><ThML.body>
<div1 id="i" title="Title Page"><p>title title title title title title title title title title</p></div1>
<div1 id="ii" title="IRENÆUS">
  <div2 id="ii.i" title="Introductory Note to Irenæus"><p>"""
    + "intro " * 20
    + """</p></div2>
  <div2 id="ii.ii" title="Against Heresies: Book I"><div3 id="a" title="Chapter I"><p>"""
    + "text " * 20
    + """</p></div3></div2>
  <div2 id="ii.iii" title="Against Heresies: Book II"><div3 id="b" title="Chapter I"><p>"""
    + "text " * 20
    + """
    <note n="1"><p><scripRef osisRef="Bible:John.1.18">John i. 18</scripRef></p></note></p></div3></div2>
</div1>
<div1 id="iii" title="City of God"><div2 id="iii.i" title="Book I"><p>"""
    + "civ " * 20
    + """</p></div2></div1>
</ThML.body></ThML>"""
)


def parse(xml: str):
    return etree.fromstring(xml.encode("utf-8"))


def test_classify_anf_groups_books_and_skips_front_matter():
    works = ccel.classify("anf01", parse(ANF_LIKE), {})
    titles = [(w.id, w.author, len(w.divs)) for w in works]
    assert ("irenaeus.against-heresies", "Irenæus", 2) in titles
    assert all("Introductory" not in w.title and w.title != "Title Page" for w in works)


def test_classify_npnf_never_reads_headings_as_authors():
    works = ccel.classify("npnf102", parse(ANF_LIKE), {})
    city = next(w for w in works if w.title == "City of God")
    assert city.author == "Augustine of Hippo"
    assert len(city.divs) == 1  # the work itself, not its books as separate works


def test_overrides_apply():
    ov = {("anf01", "iii"): {"action": "work", "title": "The City", "author": "Someone", "category": "liturgical"}}
    w = next(w for w in ccel.classify("anf01", parse(ANF_LIKE), ov) if w.title == "The City")
    assert (w.author, w.category) == ("Someone", "liturgical")


def test_sections_cites_and_citations():
    works = ccel.classify("anf01", parse(ANF_LIKE), {})
    ah = next(w for w in works if w.id == "irenaeus.against-heresies")
    secs = list(ccel.leaf_sections(ah.divs))
    assert [s.cite for s in secs] == ["1.1", "2.1"]
    assert secs[1].refs[0][0] == "Bible:John.1.18"
    assert secs[1].refs[0][1] is True  # in a footnote
    assert 'data-ref="John.1.18"' in secs[1].html
    assert "John i. 18" not in secs[1].text  # footnotes are excluded from the plain text


@pytest.mark.parametrize(
    ("title", "skip"),
    [
        ("Title Page.", True),
        ("Editor’s Preface", True),
        ("The Confessions of St. Augustin: Index of Subjects", True),
        ("Prolegomena: Life", True),
        ("General Note", True),
        ("City of God", False),
        ("Against Heresies", False),
    ],
)
def test_front_matter(title, skip):
    assert ccel.is_front_matter(title) is skip


@pytest.mark.parametrize(
    ("heading", "volume", "expected"),
    [
        ("IRENÆUS", "anf01", True),
        ("Peter of Alexandria.", "anf06", True),
        ("Excerpts of Theodotus.", "anf08", False),
        ("Early Liturgies", "anf07", False),
        ("City of God", "anf01", False),
        ("Gregory of Nyssa", "npnf205", False),
    ],
)
def test_author_headings(heading, volume, expected):
    assert ccel.is_author_heading(heading, volume) is expected


def test_smart_title():
    assert ccel.smart_title("CLEMENT OF ROME") == "Clement of Rome"
    assert ccel.author_name("IRENÆUS") == "Irenæus"


def test_ref_resolver_converts_lxx_and_vulgate_numbering(tmp_path):
    from testimonia import db
    from testimonia.ingest.base import Context
    from testimonia.sources import load

    con = db.create_core(tmp_path / "core.db")
    con.executescript(
        """
        INSERT INTO source (id, name, license) VALUES ('t', 't', 'PD');
        INSERT INTO book (osis, ord, name, testament) VALUES ('Ps', 19, 'Psalms', 'OT'), ('Jonah', 32, 'Jonah', 'OT'),
                                                            ('John', 43, 'John', 'NT');
        INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES
            (19023001, 'Ps.23.1', 'Ps', 23, 1), (19023002, 'Ps.23.2', 'Ps', 23, 2),
            (32001001, 'Jonah.1.1', 'Jonah', 1, 1), (43001018, 'John.1.18', 'John', 1, 18);
        INSERT INTO edition (id, title, language, kind, source_id) VALUES
            ('brenton', 'B', 'eng', 'translation', 't'), ('vulgate', 'V', 'lat', 'translation', 't');
        INSERT INTO edition_verse (edition_id, vkey, native_ref, text) VALUES
            ('brenton', 19023001, 'Ps.22.1', 'x'), ('brenton', 19023002, 'Ps.22.2', 'y'),
            ('vulgate', 19023001, 'Ps.22.1', 'x');
        """
    )
    resolver = ccel.RefResolver(Context(con=con, manifest=load()))
    assert resolver.resolve("Bible:John.1.18") == (43001018, 43001018)
    assert resolver.resolve("Bible.lxx:Ps.22.1") == (19023001, 19023001)
    assert resolver.resolve("Bible.lxx:Ps.22.1-Ps.22.2") == (19023001, 19023002)
    assert resolver.resolve("Bible.vul:Ps.22.1") == (19023001, 19023001)
    assert resolver.resolve("Jon.1.1") == (32001001, 32001001)
    assert resolver.resolve("Bible:John.99.1") is None
