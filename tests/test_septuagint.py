"""Swete's Greek Septuagint: TEI reading, clean-up, numbering repairs, mapping onto the hub, search."""

from __future__ import annotations

from pathlib import Path

import pytest

from testimonia import config, db
from testimonia import versification as V
from testimonia.ingest import septuagint as S
from testimonia.server import agent_tools, api
from testimonia.server.store import Store

TEI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>Ψαλμοί</title>
<editor>Henry Barclay Swete</editor></titleStmt></fileDesc></teiHeader>
<text><body><div type="edition" n="urn:cts:greekLit:tlg0527.tlg027.1st1K-grc1" xml:lang="grc">
<div type="textpart" subtype="chapter" n="22">
<head>ΚΒ΄</head>
<lg><l>Ψαλμὸς τῷ Δαυείδ.</l></lg>
<div type="textpart" subtype="verse" n="1"><p><lg><l>Κύριος ποιμαίνει με, καὶ οὐδέν με ὑστερήσει.</l></lg></p></div>
<div type="textpart" subtype="verse" n="2"><p><lg><l>εἰς τόπον χλόης, ἐκεῖ με κατε- <lb n="3"/> σκήνωσεν·</l>
<note type="marginal">U+05D0ARU</note> <note type="footnote">24 φοβηθητωσαν] φοβηθητω δη</note>
<l>ἐπὶ ὕδατος ἀναπαύσεως ἐξέθρεψέν με ;</l></lg></p></div>
</div>
<div type="textpart" subtype="chapter" n="23">
<div type="textpart" subtype="verse" n="head"><p>τοῦ μεγάλου.</p></div>
<div type="textpart" subtype="verse" n="1"><p>ΚAI [τοῦ Κυρίου]B ἡ γῆ (10)καὶ τὸ πλήρωμα §αὐτῆς¹.</p></div>
</div>
</div></body></text></TEI>
"""


def test_read_tei_titles_notes_hyphens_and_run_ons(tmp_path: Path):
    path = tmp_path / "tlg0527.tlg027.1st1K-grc1.xml"
    path.write_text(TEI, encoding="utf-8")
    verses = S.read_tei(path)
    assert verses[0] == ("22", "1", "Ψαλμὸς τῷ Δαυείδ. Κύριος ποιμαίνει με, καὶ οὐδέν με ὑστερήσει.")
    # line-break hyphenation rejoined, apparatus and sigla dropped, French spacing before ';' closed
    assert verses[1] == (
        "22",
        "2",
        "εἰς τόπον χλόης, ἐκεῖ με κατεσκήνωσεν· ἐπὶ ὕδατος ἀναπαύσεως ἐξέθρεψέν με; τοῦ μεγάλου.",
    )
    # Latin look-alikes in capitals fixed, glued siglum, brackets, verse and footnote numbers removed
    assert verses[2] == ("23", "1", "ΚΑΙ τοῦ Κυρίου ἡ γῆ καὶ τὸ πλήρωμα αὐτῆς.")


def test_swete_file_skips_other_editions(tmp_path: Path):
    work = tmp_path / "tlg034"
    work.mkdir()
    (work / "tlg0527.tlg034.1st1K-grc1.xml").write_text(TEI.replace("Henry Barclay Swete", "J. H. A. Hart"), "utf-8")
    (work / "tlg0527.tlg034.1st1K-grc2.xml").write_text(TEI, encoding="utf-8")
    assert S.swete_file(tmp_path, "tlg034") == work / "tlg0527.tlg034.1st1K-grc2.xml"
    assert S.swete_file(tmp_path, "tlg030") is None


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("καὶ ἐγένετο §ἐσπέρα", "καὶ ἐγένετο ἐσπέρα"),
        ("δέσ ποτα, 19—32κατὰ τὸ ῥῆμά σου", "δέσ ποτα, κατὰ τὸ ῥῆμά σου"),
        ("τῆ̣ γυναικὶ", "τῆ γυναικὶ"),
        ("ἀπὸ τῆς ἀνο- μίας", "ἀπὸ τῆς ἀνομίας"),
        ("οὐρανοῦ • καὶ", "οὐρανοῦ· καὶ"),
    ],
)
def test_clean(raw: str, clean: str):
    assert S.clean(raw) == clean


def test_esther_additions_are_relabelled_for_tvtms():
    verses = [
        ("prologue", "1", "A1"),
        ("1", "1", "1:1"),
        ("3", "13", "3:13"),
        ("3", "1a", "B1"),
        ("3", "2a", "B2"),
        ("3", "14", "3:14"),
        ("4", "17", "4:17"),
        ("4", "1a", "C1"),
        ("4", "1a1", "C2"),  # the file's misprint of '11a'
        ("4", "1b", "D1"),
        ("8", "12", "8:12"),
        ("8", "1a", "E1"),
        ("10", "3a", "10:3"),
        ("10", "1", "F1"),
        ("10", "11", "F11"),
    ]
    out, f = S._esther(verses)
    assert [(c, v) for c, v, _ in out] == [
        ("A", "1"),
        ("1", "1"),
        ("3", "13"),
        ("B", "1"),
        ("B", "2"),
        ("3", "14"),
        ("4", "17"),
        ("C", "1"),
        ("C", "2"),
        ("D", "1"),
        ("8", "12"),
        ("E", "1"),
        ("10", "3"),
    ]
    assert [t for _, _, t in f] == ["F1", "F11"]
    assert S.addition_f("1") == V.HubRef("AddEsth", 10, 4)
    assert S.addition_f("11") == V.HubRef("AddEsth", 11, 1)


def test_verse_number_repairs():
    verses = [("88", str(n), "t") for n in (46, 47, 84, 49)] + [("4", "11s", "x"), ("4", "12", "y")]
    fixed, n = S.repair_sequence(verses)
    assert [v for _, v, _ in fixed] == ["46", "47", "48", "49", "11s", "12"]
    assert n == 1
    raw = [("2", "35", "a"), ("2", "35a", "b"), ("2", "35I", "c"), ("2", "35i", "d"), ("6", "35s", "e")]
    labels, merged = S.subverse_labels([*raw, ("6", "36", "f"), ("6", "36", "g")])
    # OCR lettering ('I' for 'l') re-lettered in reading order; a lone '35s' is plain verse 35; a repeated
    # label runs on into the first
    assert [(c, v) for c, v, _ in labels] == [
        ("2", "35"),
        ("2", "35a"),
        ("2", "35b"),
        ("2", "35c"),
        ("6", "35"),
        ("6", "36"),
    ]
    assert labels[-1][2] == "f g"
    assert merged == 1


def _empty_rules(tmp_path: Path) -> V.Rules:
    p = tmp_path / "tvtms.txt"
    p.write_text("#DataStart(Expanded)\n#DataEnd(Expanded)\n", encoding="utf-8")
    return V.Rules.load(p)


def test_direct_verse_joins_the_hub_verse_in_reading_order(tmp_path: Path):
    rows = [("WIS", "5", "1", "καὶ τῶν ἀθετούντων"), ("WIS", "5", "2", "ἰδόντες")]
    direct = [V.HubVerse(V.HubRef("Wis", 5, 1), "Τότε στήσεται", ["Wis.4.21"], "=")]
    verses, _ = S.map_septuagint(_empty_rules(tmp_path), rows, direct)
    first = verses[0]
    assert first.hub.osis == "Wis.5.1"
    assert first.native == ["Wis.4.21", "Wis.5.1"]
    assert first.text == "Τότε στήσεται καὶ τῶν ἀθετούντων"


# ----------------------------------------------------------------------------- real data (golden)

RAW = config.RAW_DIR
TVTMS = next((RAW / "stepbible-data" / "Versification").glob("TVTMS*.txt"), None) if RAW.exists() else None
SWETE = RAW / "lxx-swete" / "data" / "tlg0527"
needs_data = pytest.mark.skipif(
    TVTMS is None or not SWETE.exists(),
    reason="raw data not fetched (run `testimonia fetch lxx-swete stepbible-tvtms`)",
)


@pytest.fixture(scope="module")
def mapped():
    assert TVTMS is not None
    rows, direct, stats = S.read_septuagint(SWETE)
    verses, map_stats = S.map_septuagint(V.Rules.load(TVTMS), rows, direct)
    return rows, {h.hub.osis: h for h in verses}, stats, map_stats


GOLDEN = {
    # hub verse: (Swete's own reference, opening words)
    "Ps.23.1": ("Ps.22.1", "Ψαλμὸς τῷ Δαυείδ. Κύριος ποιμαίνει με"),
    "Ps.22.1": ("Ps.21.2", "Ὁ θεὸς ὁ θεός μου"),
    "Ps.10.1": ("Ps.9.22", "ἵνα τί, Κύριε, ἀφέστηκας"),
    "Ps.89.48": ("Ps.88.49", "τίς ἐστιν ὁ ἄνθρωπος"),  # needs the repaired '84' → 48
    "Ps.92.1": ("Ps.91.2", "Ἀγαθὸν τὸ ἐξομολογεῖσθαι"),  # needs the Psalm 91 placeholder
    "Ps.13.1": ("Ps.12.2", "Ἕως πότε, Κύριε"),  # placed directly
    "Ps151.1.1": ("Ps.151.1", "Οὗτος ὁ ψαλμὸς ἰδιόγραφος"),
    "Isa.53.5": (None, "αὐτὸς δὲ ἐτραυματίσθη διὰ τὰς ἁμαρτίας ἡμῶν"),
    "Jer.25.15": ("Jer.32.1", "Οὕτως εἶπεν Κύριος ὁ θεὸς Ἰσραὴλ"),
    "Jer.31.31": ("Jer.38.31", "Ἰδοὺ ἡμέραι ἔρχονται"),
    "Jer.46.1": ("Jer.26.1", "ἐν ἀρχῇ βασιλεύοντος"),
    "Jer.49.35": ("Jer.25.15", "Τάδε λέγει Κύριος Συνετρίβη τὸ τόξον Αἰλάμ"),
    "Lev.7.11": ("Lev.7.1", "Οὖτος ὁ νόμος θυσίας σωτηρίου"),  # needs the Leviticus 7 placeholder
    "Mal.4.4": ("Mal.4.6", "Μνήσθητε νόμου Μωσῇ"),
    "Mal.4.5": ("Mal.4.4", "Καὶ ἰδοὺ ἐγὼ ἀποστέλλω ὑμῖν Ἠλίαν"),
    "Prov.31.10": ("Prov.29.28", "Γυναῖκα ἀνδρείαν τίς εὑρήσει"),
    "Prov.30.15": ("Prov.24.50", "Τῇ βδέλλῃ τρεῖς θυγατέρες"),
    "Neh.1.1": ("Neh.1.1", "ΛΟΓΟΙ Νεεμία"),
    "Wis.15.1": (None, "Σὺ δὲ ὁ θεὸς ἡμῶν χρηστὸς"),  # First1KGreek numbers it chapter 16
    # books and additions found only in the Septuagint
    "AddEsth.11.2": ("Esth.A.1", "ΕΤΟΥΣ δευτέρου βασιλεύοντος"),
    "AddEsth.13.1": ("Esth.B.1", "Τῆς δὲ ἐπιστολῆς ἐστὶν τὸ ἀντίγραφον"),
    "AddEsth.14.19": ("Esth.C.30", "ὁ θεὸς ὁ ἰσχύων ἐπὶ πάντας"),
    "AddEsth.15.1": ("Esth.D.1", "Καὶ ἐγενήθη ἐν τῇ ἡμέρᾳ τῇ τρίτῃ"),
    "AddEsth.16.1": ("Esth.E.1", "Ὧν ἐστιν ἀντίγραφον"),
    "AddEsth.10.4": ("Esth.F.1", "Καὶ εἶπεν Μαρδοχα"),
    "PrAzar.1.1": ("Dan.3.24", "Καὶ περιεπάτουν ἐν μέσῳ τῆς φλογὸς"),
    "Dan.3.24": ("Dan.3.91", "Καὶ Ναβουχοδονοσὸρ ἤκουσεν"),
    "Sus.1.1": (None, "ΚΑΙ ἦν ἀνήρ οἰκῶν ἐν Βαβυλῶνι"),
    "Bel.1.1": (None, "ΚΑΙ ὁ βασιλεὺς Ἀστυάγης"),
    "PrMan.1.1": (None, "Προσευχὴ Μαννασσή. Κύριε παντοκράτωρ"),
    "Bar.6.1": ("EpJer.1.1", "ΑΝΤΙΓΡΑΦΟΝ ἐπιστολῆς"),
}


@needs_data
@pytest.mark.parametrize("osis", sorted(GOLDEN))
def test_golden_mappings(mapped, osis):
    _, by, _, _ = mapped
    native, start = GOLDEN[osis]
    h = by.get(osis)
    assert h is not None, f"{osis}: no Greek text"
    assert h.text.startswith(start), f"{osis}: {h.text[:60]!r}"
    if native:
        assert h.native[0] == native


@needs_data
def test_coverage(mapped):
    rows, by, _, map_stats = mapped
    assert map_stats.get("unparseable_tests", 0) == 0
    assert map_stats.get("unmapped", 0) == 0
    assert not S.unplaced(rows, by.values())
    assert len(by) > 27_500
    assert {osis.split(".")[0] for osis in by} >= {"Gen", "Ps", "Tob", "Jdt", "Wis", "Sir", "1Macc", "4Macc", "1Esd"}


# ----------------------------------------------------------------------------- app: search and the assistant


@pytest.fixture(scope="module")
def store(tmp_path_factory) -> Store:
    path = tmp_path_factory.mktemp("lxx") / "core.db"
    con = db.create_core(path)
    con.executescript(
        """
        INSERT INTO source (id, name, license) VALUES ('t', 'test', 'PD');
        INSERT INTO book (osis, ord, name, testament, chapters) VALUES ('Ps', 19, 'Psalms', 'OT', 150);
        INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (19023001, 'Ps.23.1', 'Ps', 23, 1);
        INSERT INTO edition (id, title, abbrev, language, kind, sort, source_id) VALUES
          ('kjva', 'King James', 'KJV', 'eng', 'translation', 1, 't'),
          ('lxx-swete', 'Septuagint (Swete)', 'LXX', 'grc', 'reading_text', 31, 't');
        INSERT INTO edition_verse (edition_id, vkey, native_ref, text) VALUES
          ('kjva', 19023001, NULL, 'The LORD is my shepherd; I shall not want.'),
          ('lxx-swete', 19023001, 'Ps.22.1', 'Ψαλμὸς τῷ Δαυείδ. Κύριος ποιμαίνει με, καὶ οὐδέν με ὑστερήσει.');
        """
    )
    con.commit()
    con.close()
    return Store(path)


def test_greek_search_ignores_accents(store: Store):
    hits = api.greek_text_search(store, ["κυριος", "ποιμ"], 10)
    assert [h["osis"] for h in hits] == ["Ps.23.1"]
    assert hits[0]["abbrev"] == "LXX"
    assert "<mark>Κύριος</mark> <mark>ποιμαίνει</mark>" in hits[0]["snippet"]
    assert api.greek_text_search(store, ["λογος"], 10) == []
    assert api.greek_text_search(store, ["κυριος"], 10, edition="kjva") == []


def test_assistant_reads_the_septuagint(store: Store):
    text = agent_tools.read_passage(store, "Ps 23:1", ["kjva", "lxx-swete"])
    assert "(lxx-swete) Ψαλμὸς τῷ Δαυείδ" in text
    assert "(kjva) The LORD" in text
    assert "lxx-swete" in agent_tools.TRANSLATIONS
    assert "lxx-swete" in agent_tools.compare_translations(store, "Ps 23:1")
