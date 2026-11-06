"""TVTMS versification engine: parsing, tests, rule precedence, and real-data regressions."""

from __future__ import annotations

from pathlib import Path

import pytest

from testimonia import config
from testimonia import versification as V

HEADER = "x\n#DataStart(Expanded)\nSourceType\tSourceRef\tStandardRef\tAction\tNote\tR\tV\tA\tTests\n"
FOOTER = "#DataEnd(Expanded)\n"


def rules_from(lines: list[str], tmp_path: Path) -> V.Rules:
    p = tmp_path / "tvtms.txt"
    p.write_text(HEADER + "".join(ln + "\n" for ln in lines) + FOOTER, encoding="utf-8")
    return V.Rules.load(p)


def row(src_type: str, src: str, std: str, action: str, tests: str) -> str:
    return "\t".join([src_type, src, std, action, "", "", "", "", tests])


# ----------------------------------------------------------------------------- parsing


@pytest.mark.parametrize(
    ("label", "expected"),
    [("12", (12, 0, 0)), ("50a", (50, 1, 0)), ("1b", (1, 2, 0)), ("15-16", (15, 0, 16))],
)
def test_parse_vpl_verse(label, expected):
    assert V.parse_vpl_verse(label) == expected


def test_parse_vpl_verse_rejects_garbage():
    with pytest.raises(ValueError, match="unrecognised verse number"):
        V.parse_vpl_verse("x1")


def test_expand_refs_lists_and_ranges():
    refs = V.expand_refs("Est.1:1; 11:2-4; 12:1")
    assert [(r.book, r.ch, r.v) for r in refs] == [
        ("est", "1", 1),
        ("est", "11", 2),
        ("est", "11", 3),
        ("est", "11", 4),
        ("est", "12", 1),
    ]
    title = V.expand_refs("Psa.3:Title")[0]
    assert (title.ch, title.v) == ("3", V.TITLE)
    sub = V.expand_refs("Gen.31:50!a")[0]
    assert sub.sub == 1


def test_test_shorthand_inherits_book():
    assert V._normalise_tests("Sir.33:30=Exist & 33:31=Exist", "sir") == ("Sir.33:30=Exist", "Sir.33:31=Exist")


def test_to_hub_resolves_additions():
    assert V.to_hub(V.Ref("est", "11", 2, None)) == V.HubRef("AddEsth", 11, 2)
    assert V.to_hub(V.Ref("est", "10", 3, None)) == V.HubRef("Esth", 10, 3)
    assert V.to_hub(V.Ref("s3y", "1", 1, None)) == V.HubRef("PrAzar", 1, 1)
    assert V.to_hub(V.Ref("psa", "999", 1, None)) is None


def test_normalise_subverses_conventions():
    def u(v, sub):
        return (V.Unit("est", "1", v, sub), "t")

    # '1','1b','1c' → first part is 'a'
    out = V.normalise_subverses([u(1, 0), u(1, 2), u(1, 3)])
    assert [x.sub for x, _ in out] == [1, 2, 3]
    # '50','50a' → bare number stays main text
    out = V.normalise_subverses([(V.Unit("gen", "31", 50, 0), "t"), (V.Unit("gen", "31", 50, 1), "t")])
    assert [x.sub for x, _ in out] == [0, 1]
    # classical lettering skips 'j': i(9), k(11) → k becomes 10
    out = V.normalise_subverses([u(1, 0), u(1, 2), u(1, 9), u(1, 11)])
    assert [x.sub for x, _ in out] == [1, 2, 9, 10]


# ----------------------------------------------------------------------------- tests & rules


def test_eval_tests():
    ed = V.Edition([(V.Unit("mal", "3", v, 0), "word " * (5 if v != 23 else 1)) for v in range(1, 25)])
    assert V.eval_test(ed, "Mal.3:24=Last")
    assert V.eval_test(ed, "Mal.3:19=Exist")
    assert V.eval_test(ed, "Mal.4:1=NotExist")  # chapter absent → absent
    assert not V.eval_test(ed, "Mal.3:30=NotExist")  # chapter ended earlier → not "NotExist"
    assert V.eval_test(ed, "Mal.3:23*2<Mal.3:22+Mal.3:24")
    assert V.eval_test(ed, "Psa.3:TextBeforeV1=NotExist")
    with pytest.raises(ValueError, match="unknown test predicate"):
        V.eval_test(ed, "Mal.3:1=Sometimes")


def test_hebrew_malachi_maps_to_kjv(tmp_path):
    rules = rules_from(
        [row("Hebrew", f"Mal.3:{v}", f"Mal.4:{v - 18}", "Renumber verse", "Mal.3:24=Last") for v in range(19, 25)],
        tmp_path,
    )
    units = [("MAL", "3", str(v), f"text {v}") for v in range(1, 25)]
    verses, stats = V.map_bible(rules, units)
    by = {h.hub.osis: h for h in verses}
    assert by["Mal.4.1"].text == "text 19"
    assert by["Mal.4.6"].native == ["Mal.3.24"]
    assert by["Mal.3.18"].text == "text 18"  # identity for unaffected verses
    assert stats["rule"] == 6


def test_specific_subverse_rule_beats_whole_verse_rule(tmp_path):
    rules = rules_from(
        [
            row("Greek", "Est.1:1", "Est.1:1", "Keep verse", "Est.1:1=Exist"),
            row("Greek", "Est.1:1!a", "Est.11:2", "Renumber verse", "Est.1:1.1=Exist"),
            row("Greek", "Est.1:1!b", "Est.1:1", "Renumber verse", "Est.1:1.2=Exist"),
        ],
        tmp_path,
    )
    verses, _ = V.map_bible(rules, [("ESG", "1", "1", "Addition A"), ("ESG", "1", "1b", "Hebrew 1:1")])
    by = {h.hub.osis: h.text for h in verses}
    assert by == {"AddEsth.11.2": "Addition A", "Esth.1.1": "Hebrew 1:1"}


def test_greek_form_books_only_contribute_additions(tmp_path):
    rules = rules_from(
        [row("Greek", "Dan.3:24", "S3Y.1:1", "Renumber verse", "Dan.3:24=Exist & Dan.3:97=Last")], tmp_path
    )
    units = [("DAN", "3", str(v), f"heb {v}") for v in range(1, 31)]
    units += [("DAG", "3", str(v), f"grk {v}") for v in range(1, 98)]
    verses, stats = V.map_bible(rules, units)
    by = {h.hub.osis: h.text for h in verses}
    assert by["Dan.3.24"] == "heb 24"  # Hebrew-form Daniel wins for the protocanonical text
    assert by["PrAzar.1.1"] == "grk 24"  # the Greek form contributes the addition
    assert stats["greek_form_units_dropped"] > 0


def test_lxx_two_esdras(tmp_path):
    rules = rules_from([], tmp_path)
    verses, stats = V.map_bible(rules, [("EZR", "11", "1", "Neh 1:1 text")])
    assert [h.hub.osis for h in verses] == ["Neh.1.1"]
    verses, stats = V.map_bible(rules, [("EZR", "11", "1", "dup"), ("NEH", "1", "1", "Neh 1:1 text")])
    assert [h.text for h in verses] == ["Neh 1:1 text"]
    assert stats["skipped_duplicate_nehemiah"] == 1


def test_latin_daniel_13_14_are_susanna_and_bel(tmp_path):
    verses, _ = V.map_bible(rules_from([], tmp_path), [("DAN", "13", "1", "Sus"), ("DAN", "14", "1", "Bel")])
    assert [h.hub.osis for h in verses] == ["Sus.1.1", "Bel.1.1"]


# ----------------------------------------------------------------------------- real data (golden)

RAW = config.RAW_DIR
TVTMS = next((RAW / "stepbible-data" / "Versification").glob("TVTMS*.txt"), None) if RAW.exists() else None
needs_data = pytest.mark.skipif(TVTMS is None, reason="raw data not fetched (run `testimonia fetch --phase 0`)")

GOLDEN = {
    # edition: {hub verse: expected opening words}
    "eng-kjv": {"Ps.23.1": "A Psalm of David. The LORD is my shepherd", "Mal.4.1": "For, behold, the day"},
    "eng-Brenton": {
        "Ps.23.1": "A Psalm of David. The Lord tends me as a shepherd",
        "Mal.4.1": "For, behold, a day comes",
        "AddEsth.11.2": "In the second year",
        "Neh.1.1": "The words of Neemias",
    },
    "latVUC": {"Ps.23.1": "Psalmus David. Dominus regit me", "Sus.1.1": "Et erat vir habitans"},
    "engDRA": {"Ps.23.1": "A psalm for David. The Lord ruleth me", "Ps.3.0": "The psalm of David"},
    "eng-web": {"AddEsth.11.2": "In the second year", "PrAzar.1.1": "They walked"},
}


@needs_data
@pytest.mark.parametrize("edition", sorted(GOLDEN))
def test_golden_mappings(edition):
    from lxml import etree

    xml = next((RAW / "ebible" / f"{edition}_vpl").glob("*_vpl.xml"), None)
    if xml is None:
        pytest.skip(f"{edition} not fetched")
    assert TVTMS is not None
    rules = V.Rules.load(TVTMS)
    rows = [(e.get("b"), e.get("c"), e.get("v"), e.text or "") for _, e in etree.iterparse(str(xml), tag="v")]
    verses, stats = V.map_bible(rules, rows)
    by = {h.hub.osis: h.text for h in verses}
    for osis, start in GOLDEN[edition].items():
        assert by.get(osis, "").startswith(start), f"{edition} {osis}: {by.get(osis, '')[:60]!r}"
    assert stats.get("unparseable_tests", 0) == 0
