"""Translators' footnotes from USFM: parsing, styling, classification and native positions."""

from __future__ import annotations

from testimonia.ingest import usfm_notes as U

USFM = r"""\id JHN World English Bible
\c 1
\p
\v 17 For the law was given through Moses. Grace and truth were realized through Jesus Christ.\f + \fr 1:17 \ft “Christ” means “Anointed One”.\f*
\v 18 No one has seen God at any time. The only born\f + \fr 1:18 \ft NU reads “God”\f* Son,\x + \xo 1:18 \xt Isaiah 9:6\x* who is in the bosom of the Father, has declared him.
\v 19 \w This|strong="G3778"\w* is John’s testimony.\f + \fr 1:19 \fq testimony: \ft Or, \fqa witness\f*
\c 2
\v 1 Heb.\f + \fr 2:1 \ft Heb. the third day\f*
"""


def test_reads_notes_with_positions_and_anchors(tmp_path):
    f = tmp_path / "44-JHN.usfm"
    f.write_text(USFM, encoding="utf-8")
    notes = list(U.read_notes(f))
    assert [(n.chapter, n.verse) for n in notes] == [("1", "17"), ("1", "18"), ("1", "19"), ("2", "1")]
    assert notes[0].anchor == "realized through Jesus Christ."
    assert notes[1].anchor == "time. The only born"  # cross references (\x … \x*) are not part of the text
    assert notes[2].anchor == "This is John’s testimony."  # \w word|strong…\w* reduced to the word
    assert [U.native_ref(n) for n in notes] == ["John.1.17", "John.1.18", "John.1.19", "John.2.1"]


def test_note_styles_and_kinds(tmp_path):
    f = tmp_path / "44-JHN.usfm"
    f.write_text(USFM, encoding="utf-8")
    notes = list(U.read_notes(f))
    assert notes[0].body == "“Christ” means “Anointed One”."
    assert notes[2].body == "<i>testimony:</i> Or, <i>witness</i>"
    assert [n.kind for n in notes] == ["note", "textual", "alternative", "literal"]


def test_note_html_escapes_and_drops_reference():
    body, plain = U.note_html(r"\fr 3:16 \ft a <b> & c")
    assert body == "a &lt;b&gt; &amp; c"
    assert plain == "a <b> & c"
