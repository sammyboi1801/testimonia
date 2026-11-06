"""Footnotes from eBible USFM files.

eBible's verse-per-line (VPL) files — the source of our verse text — drop the translators' notes. The USFM
edition of the same translation keeps them as ``\\f + \\fr 1:18 \\ft NU reads “God”\\f*``. Each note is read with
its native position (book, chapter, verse) and the words it follows (its *anchor*), then placed on the hub
verse with the very same native→hub mapping the text used, so notes and text can never disagree.
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .. import versification as V

#: Within a note: \fr (reference — dropped), \ft text, \fq / \fqa quotation or alternative, \fk keyword, \fl label…
_NOTE = re.compile(r"\\f\s+\S+\s+(.*?)\\f\*", re.S)
_XREF = re.compile(r"\\x\s+\S+\s+.*?\\x\*", re.S)
_TOKEN = re.compile(r"(\\c\s+\d+|\\v\s+\S+|\\f\s+\S+\s+.*?\\f\*)", re.S)
_WORD = re.compile(r"\\\+?w\s+([^|\\]*?)(?:\|[^\\]*)?\\\+?w\*")  # \w word|strong="H1234"\w* → word
_MARKER = re.compile(r"\\\+?[a-z]+[0-9]*\*?")
_NOTE_PART = re.compile(r"\\\+?(f[a-z]+|w|x[a-z]*)\*?\s?")
_STYLE = {"fq": "i", "fqa": "i", "fk": "b", "fl": "b", "fv": "sup"}

_TEXTUAL = re.compile(
    r"\b(NU|TR|MT|Majority Text|manuscripts?|mss?\.?|Septuagint|LXX|Masoretic|Dead Sea Scrolls|Vulgate|Syriac|"
    r"Samaritan|Targum|some (?:ancient |early )?(?:copies|authorities)|other (?:copies|readings))\b"
)
_LITERAL = re.compile(r"^(?:(?:Heb|Gr|Lit|Chald|Aram|Syr)\.|(?:Literally|Hebrew|Greek|Aramaic)\b)")
_ALTERNATIVE = re.compile(r"(?:^|[:;.]\s+)[Oo]r,?\s")  # 'Or comprehended', 'testimony: Or, witness'


@dataclass(frozen=True)
class Note:
    usfm: str  # USFM book code, e.g. 'JHN'
    chapter: str
    verse: str  # verse label as written: '18', '15-16', '1a'
    anchor: str  # the last words of the verse text before the note mark ('' = at the start)
    body: str  # HTML
    plain: str
    kind: str  # 'textual' | 'alternative' | 'literal' | 'note'


def _plain(usfm: str) -> str:
    text = _XREF.sub("", usfm)
    text = _WORD.sub(r"\1", text)
    text = _MARKER.sub("", text)
    return " ".join(text.replace("¶", " ").split())


def note_html(inner: str) -> tuple[str, str]:
    """A note's USFM content as (HTML, plain text). The \\fr reference is dropped; styles become <i>/<b>."""
    inner = _WORD.sub(r"\1", inner)
    out: list[str] = []
    plain: list[str] = []
    style = "ft"
    pos = 0
    for m in _NOTE_PART.finditer(inner):
        chunk = inner[pos : m.start()]
        if chunk and style != "fr":
            text = " ".join(chunk.split())
            if text:
                tag = _STYLE.get(style)
                out.append(f"<{tag}>{html.escape(text)}</{tag}>" if tag else html.escape(text))
                plain.append(text)
        closing = m.group(0).rstrip().endswith("*")
        style = "ft" if closing else m.group(1)
        pos = m.end()
    tail = " ".join(inner[pos:].split())
    if tail and style != "fr":
        tag = _STYLE.get(style)
        out.append(f"<{tag}>{html.escape(tail)}</{tag}>" if tag else html.escape(tail))
        plain.append(tail)
    return " ".join(out).replace(" ,", ","), " ".join(plain)


def classify(plain: str, body: str) -> str:
    """'textual' (manuscripts differ) > 'literal' ('Heb. …') > 'alternative' ('Or …') > 'note'."""
    if _TEXTUAL.search(plain):
        return "textual"
    if _LITERAL.match(plain):
        return "literal"
    if _ALTERNATIVE.search(plain) or (body.startswith("<i>") and "Or" in plain):
        return "alternative"
    return "note"


def read_notes(path: Path) -> Iterator[Note]:
    """Every footnote in one USFM book file, with its native position and anchor words."""
    text = path.read_text(encoding="utf-8-sig")
    m = re.search(r"\\id\s+([A-Z0-9]{3})", text)
    if not m:
        return
    book = m.group(1)
    chapter, verse = "0", "0"
    so_far: list[str] = []  # the verse's text up to the current point
    for part in _TOKEN.split(text):
        if not part:
            continue
        if part.startswith("\\c"):
            chapter, verse, so_far = part.split()[1], "0", []
        elif part.startswith("\\v"):
            verse, so_far = part.split()[1], []
        elif part.startswith("\\f"):
            nm = _NOTE.match(part)
            if not nm or (verse == "0" and chapter == "0"):
                continue
            body, plain = note_html(nm.group(1))
            if not plain:
                continue
            words = " ".join(so_far).split()
            yield Note(book, chapter, verse, " ".join(words[-4:]), body, plain, classify(plain, body))
        else:
            so_far.append(_plain(part))


def native_ref(note: Note) -> str | None:
    """The note's position as the same native reference the text mapping uses (e.g. 'Phil.1.17')."""
    step = V.USFM_TO_STEP.get(note.usfm)
    if step is None:
        return None
    ch = note.chapter
    if note.usfm == "EZR" and ch.isdigit() and int(ch) > 10:
        step, ch = "Neh", str(int(ch) - 10)
    try:
        v, sub, through = V.parse_vpl_verse(note.verse)
    except ValueError:
        return None
    return V.Unit(V.norm_book(step), ch.lower(), v, sub, through).native


def read_edition(folder: Path) -> list[Note]:
    notes: list[Note] = []
    for f in sorted(folder.glob("*.usfm")):
        notes.extend(read_notes(f))
    return notes
