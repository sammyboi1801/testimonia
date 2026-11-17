"""Philo (Yonge 1854–55) from the Internet Archive OCR: page furniture removed, broken lines and paragraphs mended,
treatises found by heading, sections numbered (OCR slips read), footnoted Scripture linked."""

from __future__ import annotations

from testimonia.ingest import philo as p

PAGES = """\
A   TEEATISE

O.V    THE    ACCOUNT   OF

THE  CREATION  OF  THE  VORLD.


I.  Of  other  lawgivers,  some  have  set  forth  what  they  con-
sidered to  be  just,  in  a  naked  manner ;  but  Moses*  made
the  beginning  of  his  laws

B


2  PHILO   JUD.EUS.

entirely  beautiful.  He  says,  "In  the  beginning  God  made
the  heaven."

*  Genesis  i.  1.


II.  And  the  second  thing  is  this.

£60  PHILO   JUDJEUS.

XTX.  This  numeral  is  not  the  next  one,  so  it  stays  text.

III.  The  third,  quoting  the  law :
f  Genesis  ii.  4.  j  Genesis  ii.  5.
and  continuing  after  the  notes.

A    TREATISE  ON  THE  CHERUBIM ;

I.  The  cherubim  section.  It  goes  on  long  enough  to  be  a  section.

II.  More.
"""


def test_page_furniture_and_footnotes_are_recognised():
    assert p.is_running_head("2  PHILO   JUD.EUS. ")
    assert p.is_running_head("£60  PHILO   JUDJEUS. ")  # a mangled page number
    assert p.is_running_head("ON   THE   CREATION   OF    THE    WORLD.  5 ")
    assert not p.is_running_head("THE    FIRST   FESTIVAL. ")  # a heading inside a treatise has no number
    assert p.SIGNATURE.match("B")
    assert p.SIGNATURE.match("VOL.  II.  C ")
    assert p.is_note_line("f  Genesis  ii.  4.  j  Genesis  ii.  5.")
    assert p.is_note_line("Exodus xii. 23. t Numbers xxxl 26.")  # garbled numerals still a note line
    assert not p.is_note_line("And the second thing is this, as the law says in Genesis.")


def test_references_in_yonges_style():
    assert p.scripture("*  Genesis  ii.  4.  Gen.  xlii,  36.  Deuteronomy  xvi.  21-23") == [
        "Gen.2.4",
        "Gen.42.36",
        "Deut.16.21-Deut.16.23",
    ]
    assert p.scripture("Numbers xxxl 26") == []  # a garbled numeral is not guessed at


def test_numerals_and_misreadings():
    assert p.roman("XLIII") == 43
    assert p._misread("XTX") == 19
    assert p._misread("XYI") == 16
    assert p._misread("HI") == 3
    assert p._misread("XIX") is None  # not a misreading


def test_a_treatise_is_cut_into_sections_with_its_scripture():
    lines = PAGES.splitlines()
    t1 = p.Treatise(1, "philo.opificio", "On the Creation", "De opificio mundi", r"CREATION OF THE [VW]ORLD")
    t2 = p.Treatise(1, "philo.cherubim", "On the Cherubim", "De cherubim", r"TREATISE ON THE CHERUBIM")
    starts = p.find_starts(lines, [t1, t2])
    assert lines[starts[0]].startswith("A   TEEATISE")
    assert lines[starts[1]].startswith("A    TREATISE  ON  THE  CHERUBIM")
    body = lines[starts[0] : starts[1]]
    k = next(i for i, ln in enumerate(body) if ln.strip() and not p.is_heading(ln))
    secs = p.sections(p.paragraphs(body[k:]), None)
    assert [s.cite for s in secs] == ["1", "2", "3"]
    first = secs[0].text
    # the broken word and the paragraph the page break cut are mended; the header and signature are gone
    assert "considered to be just" in first
    assert "his laws entirely beautiful" in first
    assert "PHILO" not in first
    assert "Moses made" in first  # the footnote mark is gone
    assert ("Gen.1.1", True, "") in secs[0].refs  # the footnote's reference, given to its section
    # the misread numeral that is not the next one stays in section 2's text
    assert "XTX." in secs[1].text
    # notes printed amid a paragraph are kept apart, and the paragraph joined again
    assert "quoting the law: and continuing after the notes." in secs[2].text
    assert {"Gen.2.4", "Gen.2.5"} <= {r[0] for r in secs[2].refs}


def test_philos_citations_have_a_kind_the_schema_allows():
    """(A build once failed here: 'quote' is not one of the citation kinds.)"""
    import inspect
    import re
    from pathlib import Path

    from testimonia.ingest import witnesses

    schema = (Path(__file__).parent.parent / "schema" / "core.sql").read_text(encoding="utf-8")
    citation = schema[schema.index("CREATE TABLE citation") :]
    allowed = re.search(r"kind\s+TEXT CHECK \(kind IN \(([^)]*)\)\)", citation).group(1)
    kinds = set(re.findall(r"'([a-z]+)'", allowed))
    used = set(re.findall(r'kind="([a-z]+)"', inspect.getsource(witnesses.philo_works)))
    assert used
    assert used <= kinds


def test_questions_open_their_answers():
    items = [
        (False, 'Why does Moses say: "This is the book of the generation?"t'),
        (False, "1. The expression indicates an indeterminate time."),
        (False, 'What is the meaning of "A fountain went up?"'),
        (False, "2. Here the question is how it could be."),
    ]
    secs = p.sections(items, 1, qa=True)
    assert [s.cite for s in secs] == ["1.1", "1.2"]
    assert secs[0].title.startswith("Why does Moses say")
    assert secs[0].html.startswith('<p class="question"><b>Why does Moses')
    assert "indeterminate" in secs[0].text
    assert secs[1].title.startswith("What is the meaning")
