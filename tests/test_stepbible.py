"""STEPBible parsers: word references, edition lists, variants, Hebrew morphemes."""

from __future__ import annotations

from testimonia.ingest import stepbible as S


def test_parse_word_ref():
    r = S.parse_word_ref("Jhn.1.18#07=N(K)O")
    assert (r.book, r.ch, r.v, r.word, r.type, r.native) == ("John", 1, 18, 7, "N(K)O", None)
    r = S.parse_word_ref("Psa.3.1(3.2)#01=L")
    assert (r.book, r.ch, r.v, r.native) == ("Ps", 3, 1, "Ps.3.2")
    assert S.parse_word_ref("# Jhn.1.18\tΘεὸν") is None
    assert S.parse_word_ref("Xyz.1.1#01=L") is None


def test_normalize_strips_accents_and_points():
    assert S.normalize("Θεὸν") == "θεον"
    assert S.normalize("πατρός,") == "πατρος"
    assert S.normalize("בְּרֵאשִׁ֖ית") == "בראשית"


def test_parse_editions_markers_and_manuscripts():
    eds = S.parse_editions("NA28+NA27+Tyn+SBL+WH²+Treg²+TR+Byz+014")
    assert eds.base == ("NA28", "NA27", "Tyn", "SBL", "WH", "Treg", "TR", "Byz")
    assert eds.reordered == ("WH", "Treg")
    assert eds.others == ("014",)


def _witness_ids(readings, n):
    return {w[1] for w in readings[n][2]}


def test_greek_meaning_variant():
    eds = S.parse_editions("NA28+NA27+SBL+WH+Treg")
    unit, readings = S._greek_unit(
        43001018, "θεὸς", "God", eds, "υἱός (T=huios) son - G5207=N-NSM in: Tyn+TR+Byz", "", "v note"
    )
    assert unit["significance"] == "meaning"
    assert [r[0] for r in readings] == ["θεὸς", "υἱός"]
    assert _witness_ids(readings, 1) == {"Tyn", "TR", "Byz"}


def test_greek_omission_and_order():
    unit, readings = S._greek_unit(43001018, "ὁ", "the", S.parse_editions("Tyn+TR+Byz"), "", "", "")
    assert unit["significance"] == "omission"
    assert readings[1][0] == ""
    assert _witness_ids(readings, 1) == {"NA28", "NA27", "SBL", "WH", "Treg"}
    unit, readings = S._greek_unit(1, "καὶ", "and", S.parse_editions("NA28+NA27+Tyn+SBL+WH+Treg+TR2+Byz2"), "", "", "")
    assert unit["significance"] == "order"
    assert _witness_ids(readings, 1) == {"TR", "Byz"}


def test_no_unattested_readings():
    # complete edition list plus an extra manuscript: no phantom omission reading
    _, readings = S._greek_unit(
        1, "μεγάλα", "great", S.parse_editions("NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz+014"), "", "", ""
    )
    assert all(r[2] for r in readings)
    assert ("manuscript", "GA:014", None) in readings[0][2]


def test_hebrew_parts_and_join():
    parts = S._hebrew_parts("הָ/אָֽרֶץ\\׃", "H9009/{H0776G}\\H9016", "HTd/Ncfsa")
    assert [p["strong"] for p in parts] == ["H9009", "H0776G", "H9016"]
    assert [p["morph"] for p in parts][:2] == ["HTd", "HNcfsa"]
    assert S._join_hebrew(["מָֽה־", "רַבּ֣וּ"]) == "מָֽה־רַבּ֣וּ"  # no space after maqaf
    assert S._join_hebrew(["בָּרָ֣א", "אֱלֹהִ֑ים"]) == "בָּרָ֣א אֱלֹהִ֑ים"


def test_hebrew_ketiv_qere_unit():
    unit, readings = S._hebrew_unit(
        1009021, "אָהֳלֽוֹ׃", "tent/ his", "Q(K)", 'K= \'o.ho.Lo/h (אָהֳלֹ/ה\\׃) "tent/ his" (H0168G/H9023)'
    )
    assert unit["significance"] == "ketiv-qere"
    assert [r[0] for r in readings] == ["אָהֳלֽוֹ׃", "אָהֳלֹה׃"]
    assert readings[1][2][0][2] == "ketiv"
