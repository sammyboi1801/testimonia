"""Scripture reference parsing.

Two representations are used everywhere:
  * verse id  : "John.1.18"  (OSIS-style, human readable, matches BTB/STEPBible)
  * verse key : int  book_order*1_000_000 + chapter*1_000 + verse   (sortable; ranges = BETWEEN)

parse_refs("1 Cor. 13:4-7; 15:3, 5") -> [Range(1Cor.13.4..1Cor.13.7), Range(1Cor.15.3), Range(1Cor.15.5)]
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .books import BY_OSIS, alias_regex, resolve_book


def vkey(book: str, ch: int, v: int) -> int:
    return BY_OSIS[book].order * 1_000_000 + ch * 1_000 + v


def vid(book: str, ch: int, v: int) -> str:
    return f"{book}.{ch}.{v}"


def key_to_parts(key: int) -> tuple[str, int, int]:
    from .books import BOOKS

    order, rest = divmod(key, 1_000_000)
    ch, v = divmod(rest, 1_000)
    return BOOKS[order - 1].osis, ch, v


def id_to_key(verse_id: str) -> int | None:
    p = verse_id.split(".")
    if len(p) != 3 or p[0] not in BY_OSIS:
        return None
    try:
        return vkey(p[0], int(p[1]), int(p[2]))
    except ValueError:
        return None


@dataclass(frozen=True)
class Range:
    book: str
    c1: int
    v1: int  # 0 = whole chapter
    c2: int
    v2: int  # 999 = to end of chapter

    @property
    def start(self) -> int:
        return vkey(self.book, self.c1, self.v1 or 1)

    @property
    def end(self) -> int:
        return vkey(self.book, self.c2, self.v2 if self.v2 else 999)

    @property
    def start_id(self) -> str:
        return vid(self.book, self.c1, self.v1 or 1)

    def label(self) -> str:
        name = BY_OSIS[self.book].name
        if self.v1 == 0 and self.c1 == self.c2:
            return f"{name} {self.c1}"
        if self.c1 == self.c2:
            if self.v1 == self.v2:
                return f"{name} {self.c1}:{self.v1}"
            return f"{name} {self.c1}:{self.v1}–{self.v2}"
        return f"{name} {self.c1}:{self.v1 or 1}–{self.c2}:{self.v2 if self.v2 != 999 else 'end'}"


_OSIS_RE = re.compile(r"^([1-4]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?(?:-(?:([1-4]?[A-Za-z]+)\.)?(\d+)(?:\.(\d+))?)?$")
# A book name only counts when a chapter/verse number follows ("Isa 7", "1 Cor. 13:4", "Jude 3").
_BOOK_RE = re.compile(r"(?<![A-Za-z])(" + alias_regex() + r")\.?(?=\s*\d)", re.I)
_DASH = "[-–—]"


def parse_osis(s: str) -> Range | None:
    """Parse 'John.1.18', 'John.1', 'John.1.18-John.1.20', 'John.1.18-20'."""
    m = _OSIS_RE.match(s.strip())
    if not m or m.group(1) not in BY_OSIS:
        return None
    b, c1, v1 = m.group(1), int(m.group(2)), int(m.group(3) or 0)
    if m.group(5):
        a, bb = int(m.group(5)), m.group(6)
        if bb is not None:  # ...-Book.C.V or -C.V
            return Range(b, c1, v1, a, int(bb))
        if m.group(4):  # ...-Book.C
            return Range(b, c1, v1, a, 999)
        return Range(b, c1, v1, c1, a) if v1 else Range(b, c1, 0, a, 999)
    return Range(b, c1, v1, c1, v1 if v1 else 999)


def _single_chapter(book: str) -> bool:
    return BY_OSIS[book].chapters == 1


def parse_refs(text: str, default_book: str | None = None) -> list[Range]:
    """Parse free-text references. Handles '1 Cor. 13:4-7; 15:3, 5', 'Jn 1:1,14', 'Ps 23', 'Jude 3',
    'John 1:18-2:3', and bare continuation refs after a book has been seen."""
    out: list[Range] = []
    text = text.replace(" ", " ")
    # split into segments, each beginning with a book name (or continuing previous book)
    pos = 0
    book = default_book
    spans: list[tuple[str | None, str]] = []
    for m in _BOOK_RE.finditer(text):
        if m.start() > pos and book:
            spans.append((book, text[pos : m.start()]))
        osis = resolve_book(m.group(1))
        if osis:
            book = osis
        pos = m.end()
    if book:
        spans.append((book, text[pos:]))
    for book, seg in spans:
        if not book:
            continue
        out.extend(_parse_numbers(book, seg))
    return out


_NUM_TOKEN = re.compile(rf"(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*{_DASH}\s*(\d+)(?:\s*[:.]\s*(\d+))?)?")


def _parse_numbers(book: str, seg: str) -> list[Range]:
    res: list[Range] = []
    chapter: int | None = None
    single = _single_chapter(book)
    # stop at first letter-run that isn't part of the numbering (e.g. 'with', 'compare')
    seg = re.split(r"[A-Za-z]{3,}", seg, maxsplit=1)[0]
    parts: list[tuple[bool, str]] = []  # (starts_new_semicolon_group, text)
    for group in seg.split(";"):
        for pi, p in enumerate(group.split(",")):
            parts.append((pi == 0, p))
    verse_ctx = False  # was the previous ref verse-level?
    for new_group, raw in parts:
        part = raw.strip()
        if new_group:
            verse_ctx = False
        m = _NUM_TOKEN.match(part) if part else None
        if not m:
            continue
        a = int(m.group(1))  # group 1 is mandatory in _NUM_TOKEN
        b, c, d = (int(x) if x else None for x in m.group(2, 3, 4))
        if b is not None:  # a:b ...
            chapter = a
            if c is not None and d is not None:  # a:b-c:d (a following ', 29-30' continues chapter c)
                res.append(Range(book, a, b, c, d))
                chapter = c
            elif c is not None:  # a:b-c
                res.append(Range(book, a, b, a, c))
            else:
                res.append(Range(book, a, b, a, b))
            verse_ctx = True
        elif single:  # Jude 3, Jude 3-5
            res.append(Range(book, 1, a, 1, c if c is not None else a))
            chapter, verse_ctx = 1, True
        elif verse_ctx and chapter is not None and c is not None and d is not None:  # ", 30-35:1" crosses a chapter
            res.append(Range(book, chapter, a, c, d))
            chapter = c
        elif verse_ctx and chapter is not None:  # continuation verse after a:b  (", 14")
            res.append(Range(book, chapter, a, chapter, c if c is not None else a))
        elif c is not None and d is not None:  # 'Gen 1-3:5'
            chapter = a
            res.append(Range(book, a, 0, c, d))
            verse_ctx = True
        else:  # whole chapter(s): 'Ps 23', 'Gen 1-3'
            chapter = a
            res.append(Range(book, a, 0, c if c is not None else a, 999))
    return res
