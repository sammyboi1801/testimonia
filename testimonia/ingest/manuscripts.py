"""Manuscripts from Wikipedia's lists: NT papyri, uncials, notable minuscules, Septuagint codices, Dead Sea Scrolls.

The lists are wikitext tables (fetched as raw wikitext of pinned revisions, CC BY-SA 4.0). Each row becomes a
`manuscript` (sigla, name, institution, shelfmark, date label, contents), a `dating` window under the 'scholarly'
system, `manuscript_coverage` verse ranges parsed from the contents column, and `external_id` rows (Wikipedia
article, Gregory–Aland number, Rahlfs siglum, Qumran number).

* Contents such as "Gospels†, Acts" map to whole books (the dagger marks lacunae → completeness 'partial');
  explicit references ("John 18:31–33, 37–38") are parsed with :func:`testimonia.refs.parse_refs`; clauses after
  "lacking / missing / except" are subtracted.
* Dates such as "110-140", "4th", "5th/6th", "c. 950", "Herodian" or "356–103 BCE" become a window; Qumran script
  periods (Archaic, Hasmonean, Herodian…) are also stored in `manuscript.script`.
* A Septuagint codex that is also a Gregory–Aland uncial (Sinaiticus, Alexandrinus, Vaticanus…) is merged into the
  GA record, which then carries both its Old and New Testament contents.
* Images are never copied: the Leon Levy Dead Sea Scrolls Library URL is kept as a link (``image_url``); NT
  manuscript images are linked on the INTF's NTVMR by the API.
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ..books import BY_OSIS, alias_regex, resolve_book
from ..refs import parse_refs
from .base import Context, IngestError, step

SOURCE = "wikipedia-manuscripts"
DSS_SOURCE = "wikipedia-dss"
SYSTEM = "scholarly"
#: Sanity floors: a list that parses to fewer rows has changed layout (tests lower them for small fixtures).
MIN_PAPYRI = 100
MIN_SCROLLS = 300

COLLECTIONS = {
    "papyri": "NT papyri",
    "uncials": "NT majuscules",
    "minuscules": "NT minuscules",
    "lxx": "LXX manuscripts",
    "dss": "Dead Sea Scrolls",
}

# ============================================================================ wikitext

_COMMENT = re.compile(r"<!--.*?-->", re.S)
_INCLUDE = re.compile(r"</?(?:onlyinclude|noinclude|includeonly)\s*>", re.I)
_REF = re.compile(r"<ref\b[^>]*?/>|<ref\b[^>]*>.*?</ref\s*>", re.S | re.I)
_LEON = re.compile(r"https?://www\.deadseascrolls\.org\.il/explore-the-archive/manuscript/[\w.-]+")
_MARK = re.compile(r"⟦([^⟧]*)⟧")
_ATTRS = re.compile(r"""\s*(?:[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|"']+)\s*)+""")

_SUP_FROM = "abcdefghijklmnoprstuvwxyz0123456789+-"
_SUP_TO = "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻"
_SUP = str.maketrans(_SUP_FROM, _SUP_TO)


def superscript(s: str) -> str:
    return s.translate(_SUP)


def clean_source(text: str) -> str:
    """Drop comments, transclusion tags and footnotes; a footnote citing a Leon Levy scroll page leaves its URL
    behind as a ⟦url⟧ marker (an image link, kept as a link only)."""
    text = _COMMENT.sub("", text)
    text = _INCLUDE.sub("", text)

    def ref(m: re.Match[str]) -> str:
        url = _LEON.search(m.group(0))
        return f" ⟦{url.group(0)}⟧ " if url else ""

    return _REF.sub(ref, text)


def split_top(s: str, sep: str) -> list[str]:
    """Split on `sep` outside [[links]] and {{templates}}."""
    out: list[str] = []
    depth, i, start = 0, 0, 0
    while i < len(s):
        two = s[i : i + 2]
        if two in ("[[", "{{"):
            depth += 1
            i += 2
            continue
        if two in ("]]", "}}"):
            depth = max(0, depth - 1)
            i += 2
            continue
        if depth == 0 and s.startswith(sep, i):
            out.append(s[start:i])
            i += len(sep)
            start = i
            continue
        i += 1
    out.append(s[start:])
    return out


@dataclass
class _Cell:
    text: str
    rowspan: int = 1
    header: bool = False


@dataclass
class Table:
    heading: str
    header: list[str] = field(default_factory=list)
    rows: list[dict[str, str]] = field(default_factory=list)


def _cell(raw: str, header: bool) -> _Cell:
    parts = split_top(raw, "|")
    rowspan = 1
    if len(parts) > 1 and (not parts[0].strip() or _ATTRS.fullmatch(parts[0])):  # "|| text" = empty attributes
        m = re.search(r"rowspan\s*=\s*[\"']?(\d+)", parts[0], re.I)
        rowspan = int(m.group(1)) if m else 1
        raw = "|".join(parts[1:])
    return _Cell(raw.strip(), rowspan, header)


def tables(text: str) -> list[Table]:
    """Every wikitable in a page, rows as {lower-cased header: raw cell wikitext}; rowspans are expanded."""
    out: list[Table] = []
    heading = ""
    table: Table | None = None
    row: list[_Cell] = []
    pending: dict[int, list[object]] = {}
    nested = 0

    def finish_row() -> None:
        nonlocal row
        if table is None or not row:
            row = []
            return
        if all(c.header for c in row):
            if not table.header and len(row) > 1:
                table.header = [plain(c.text).lower().strip() for c in row]
            row = []
            return
        values: list[str] = []
        col = 0

        def take(col: int) -> str:
            slot = pending[col]
            slot[0] = int(str(slot[0])) - 1
            if int(str(slot[0])) <= 0:
                del pending[col]
            return str(slot[1])

        for c in row:
            while col in pending:
                values.append(take(col))
                col += 1
            values.append(c.text)
            if c.rowspan > 1:
                pending[col] = [c.rowspan - 1, c.text]
            col += 1
        while col in pending:
            values.append(take(col))
            col += 1
        if table.header:
            table.rows.append(dict(zip(table.header, values, strict=False)))
        row = []

    for line in text.splitlines():
        s = line.strip()
        if table is None:
            m = re.match(r"^(=+)\s*(.*?)\s*\1$", s)
            if m:
                heading = plain(m.group(2))
            elif s.startswith("{|"):
                table, row, pending = Table(heading), [], {}
            continue
        if s.startswith("{|"):
            nested += 1
            continue
        if nested:
            if s.startswith("|}"):
                nested -= 1
            continue
        if s.startswith("|}"):
            finish_row()
            out.append(table)
            table = None
            continue
        if s.startswith("|-"):
            finish_row()
            continue
        if s.startswith("|+"):
            continue
        if s.startswith("!"):
            row.extend(_cell(c, True) for part in split_top(s[1:], "!!") for c in split_top(part, "||"))
        elif s.startswith("|"):
            row.extend(_cell(c, False) for c in split_top(s[1:], "||"))
        elif row:
            row[-1].text += "\n" + line
    return out


def _template(m: re.Match[str], sup: bool) -> str:
    parts = [p.strip() for p in m.group(1).split("|")]
    name = parts[0].lower()
    arg = parts[1] if len(parts) > 1 else ""
    if name == "sup":
        return superscript(arg) if sup else arg
    if name in ("papyrus link", "papyrus"):
        return f"𝔓{superscript(arg)}" if sup else f"P{arg}"
    if name == "lang":
        return parts[-1]
    if name in ("nowrap", "small", "nobr", "sub", "abbr", "smallcaps", "angbr"):
        return arg
    if name in ("circa", "c."):
        return f"c. {arg}".strip()
    if name == "ndash":
        return "–"
    if name == "mdash":
        return "—"
    return ""


def _link(m: re.Match[str], expand: bool = False) -> str:
    inner = m.group(1)
    target, _, label = inner.partition("|")
    target = target.strip().lstrip(":").split("#")[0]
    if target.lower().startswith(("file:", "image:", "category:")):
        return ""
    if label and expand and (len(label) <= 5 or "." in label):  # '[[British Library|BL]]' → 'British Library'
        return target
    return label if label else target


def plain(s: str, sup: bool = True, expand: bool = False) -> str:
    """Wikitext → plain text (links → labels, templates mostly dropped, <sup> → superscript characters).
    ``expand`` replaces abbreviated link labels by the article title (institution names)."""
    s = re.sub(r"<br\s*/?\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<sup>(.*?)</sup>", lambda m: superscript(m.group(1)) if sup else m.group(1), s, flags=re.I | re.S)
    passes = ((r"\{\{([^{}]*)\}\}", lambda m: _template(m, sup)), (r"\[\[([^\[\]]*)\]\]", lambda m: _link(m, expand)))
    for pattern, func in passes:
        while True:
            new = re.sub(pattern, func, s)
            if new == s:
                break
            s = new
    s = re.sub(r"\[(?:https?:)?//[^\s\]]+\s*([^\]]*)\]", r"\1", s)
    s = _MARK.sub("", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    s = html.unescape(s).replace("\xa0", " ")
    lines = [" ".join(ln.split()) for ln in s.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def one_line(s: str, sep: str = "; ") -> str:
    return sep.join(ln.strip(" ,;") for ln in plain(s).split("\n") if ln.strip(" ,;"))


_FIRST_LINK = re.compile(r"\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|[^\[\]]*)?\]\]")


def first_link(s: str) -> str | None:
    for m in _FIRST_LINK.finditer(s):
        target = m.group(1).strip().lstrip(":")
        if not target.lower().startswith(("file:", "image:", "category:")):
            return target[0].upper() + target[1:] if target else None
    return None


def leon_url(row: Iterable[str]) -> str | None:
    for cell in row:
        m = _MARK.search(cell)
        if m:
            return m.group(1)
    return None


# ============================================================================ dates

_ERA = r"(b\.?\s?c\.?\s?e\.?|b\.?\s?c\.?|c\.?\s?e\.?|a\.?\s?d\.?)"
_RANGE = re.compile(
    rf"(?:{_ERA}\s*)?(\d{{1,4}})\s*{_ERA}?\s*(?:-|–|—|to)\s*(?:{_ERA}\s*)?(\d{{1,4}})(?!\d|st|nd|rd|th)\s*{_ERA}?", re.I
)
_CENT = re.compile(
    r"(early|late|mid|middle|first half of(?: the)?|second half of(?: the)?|later half of(?: the)?|"
    r"latter half of(?: the)?|beginning of(?: the)?|end of(?: the)?|turn of(?: the)?)?[\s-]*"
    r"(\d{1,2})(?:st|nd|rd|th)(?:\s*(?:/|-|–|or|to)\s*(\d{1,2})(?:st|nd|rd|th))?\s*"
    rf"(?:centur(?:y|ies)|cent\.?|c\.)?\s*{_ERA}?",
    re.I,
)
_YEAR = re.compile(
    rf"(?:(c\.|ca\.|circa|~|about|around)\s*)?(?:{_ERA}\s*)?(\d{{3,4}}|\d{{1,2}}(?=\s*{_ERA}))\s*{_ERA}?", re.I
)
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}
_ROMAN.update({"XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15, "XVI": 16, "XVII": 17, "XVIII": 18})

#: Palaeographic periods of the Judaean Desert scripts (Cross's typology) → astronomical-year windows.
SCRIPT_PERIODS: tuple[tuple[str, str, int, int], ...] = (
    ("late herodian", "Late Herodian", 1, 68),
    ("early herodian", "Early Herodian", -29, 1),
    ("post-herodian", "Post-Herodian", 68, 135),
    ("herodian", "Herodian", -29, 68),
    ("late hasmonean", "Late Hasmonean", -74, -29),
    ("early hasmonean", "Early Hasmonean", -149, -99),
    ("hasmonean", "Hasmonean", -149, -29),
    ("hellenistic-roman", "Hellenistic-Roman", -249, 68),
    ("hellenistic", "Hellenistic", -249, -62),
    ("archaic", "Archaic", -249, -149),
    ("proto-cryptic", "Proto-cryptic", -249, -99),
    ("roman", "Roman", -62, 135),
)
_SCRIPT_RE = re.compile("|".join(re.escape(k) for k, *_ in SCRIPT_PERIODS), re.I)
_SCRIPT = {k: (label, lo, hi) for k, label, lo, hi in SCRIPT_PERIODS}
_HANDS = re.compile(r"palaeo-?hebrew|paleo-?hebrew|cryptic|square|semiformal|semi-formal|semicursive|cursive", re.I)


@dataclass(frozen=True)
class DateWindow:
    lo: int
    hi: int
    circa: bool
    basis: str | None


def _is_bc(era: str | None) -> bool:
    return (era or "").lower().replace(".", "").replace(" ", "").startswith("b")


def _year(y: int, bc: bool) -> int:
    return 1 - y if bc else y


def _century(n: int, bc: bool, mod: str | None) -> tuple[int, int]:
    lo, hi = (100 * (n - 1) + 1, 100 * n) if not bc else (1 - 100 * n, 100 - 100 * n)
    mod = (mod or "").lower()
    if mod in ("early", "beginning of the", "beginning of", "first half of the", "first half of"):
        return (lo, lo + 49) if "half" in mod else (lo, lo + 32)
    if mod in ("late", "end of the", "end of", "second half of the", "second half of", "later half of the"):
        return (hi - 49, hi) if "half" in mod else (hi - 32, hi)
    if mod in ("later half of", "latter half of", "latter half of the"):
        return (hi - 49, hi)
    if mod in ("mid", "middle"):
        return (lo + 25, hi - 25)
    if mod.startswith("turn of"):
        return (hi - 15, hi + 15)
    return (lo, hi)


def parse_date(label: str) -> DateWindow | None:
    """A date label from the lists → a window in astronomical years (None when it carries no date)."""
    text = " ".join(label.replace("–", "-").replace("—", "-").split())
    if not text:
        return None
    spans: list[tuple[int, int]] = []
    circa = bool(re.search(r"\b(c\.|ca\.|circa)|~|\?", text, re.I))
    basis: str | None = None
    roman = re.fullmatch(r"\s*([IVX]+)\s*(?:/|-)?\s*([IVX]+)?\s*(?:\(.*\))?\s*", text)
    if roman and roman.group(1) in _ROMAN:
        a = _ROMAN[roman.group(1)]
        b = _ROMAN.get(roman.group(2) or "", a)
        return DateWindow(100 * (a - 1) + 1, 100 * b, False, "palaeography")
    rest = text
    for m in list(_RANGE.finditer(rest)):
        era_a = m.group(1) or m.group(3)
        era_b = m.group(4) or m.group(6)
        a, b = int(m.group(2)), int(m.group(5))
        if b < a and len(m.group(5)) < len(m.group(2)) and not (era_a or era_b):  # '1285-6' → 1285–1286
            b = int(m.group(2)[: -len(m.group(5))] + m.group(5))
        bc_b = _is_bc(era_b) if era_b else (_is_bc(era_a) if era_a else a > b)  # '100–50' with no era is BC
        bc_a = _is_bc(era_a) if era_a else bc_b
        lo, hi = sorted((_year(a, bc_a), _year(b, bc_b)))
        spans.append((lo, hi))
        rest = rest.replace(m.group(0), " ", 1)
    for m in list(_CENT.finditer(rest)):
        a = int(m.group(2))
        b = int(m.group(3) or a)
        bc = _is_bc(m.group(4))
        if not 1 <= a <= 20 or not 1 <= b <= 20:
            continue
        lo1, hi1 = _century(a, bc, m.group(1))
        lo2, hi2 = _century(b, bc, None if m.group(3) else m.group(1))
        spans.append((min(lo1, lo2), max(hi1, hi2)))
        basis = "palaeography"
        rest = rest.replace(m.group(0), " ", 1)
    for m in list(_YEAR.finditer(rest)):
        y = int(m.group(3))
        bc = _is_bc(m.group(2) or m.group(4))
        if not bc and y > 2000:
            continue
        spans.append((_year(y, bc), _year(y, bc)))
        circa = circa or bool(m.group(1))
        rest = rest.replace(m.group(0), " ", 1)
    if not spans:  # a script period dates a hand only when the label gives no explicit years
        for m in _SCRIPT_RE.finditer(rest):
            _, lo, hi = _SCRIPT[m.group(0).lower()]
            spans.append((lo, hi))
            basis = "palaeography"
            circa = True
    if not spans:
        return None
    lo, hi = min(s[0] for s in spans), max(s[1] for s in spans)
    if hi > 2000 or lo < -1000:
        return None
    return DateWindow(lo, hi, circa, basis)


def scripts(label: str) -> str | None:
    """Palaeographic script/period words in a date label ('Hasmonean', 'Herodian', 'Paleo-Hebrew')."""
    found: list[str] = []
    rest = label
    for m in _SCRIPT_RE.finditer(label):
        found.append(_SCRIPT[m.group(0).lower()][0])
        rest = rest.replace(m.group(0), " ")
    for m in _HANDS.finditer(rest):
        word = m.group(0).lower().replace("palaeo", "paleo")
        found.append("Paleo-Hebrew" if word.startswith("paleo") else word.capitalize())
    return ", ".join(dict.fromkeys(found)) or None


def precision(lo: int, hi: int) -> str:
    width = hi - lo
    if width >= 90:
        return "century"
    if width >= 40:
        return "half-century"
    if width >= 20:
        return "quarter-century"
    if width >= 8:
        return "decade"
    return "year"


# ============================================================================ contents → verse ranges

_FIRST = BY_OSIS["Gen"].order
GROUPS: dict[str, tuple[str, str]] = {}
for _names, _span in (
    (("new testament", "nt", "entire new testament", "whole new testament"), ("Matt", "Rev")),
    (("gospels", "gospel", "four gospels", "the gospels", "e", "evangelia", "tetraevangelion"), ("Matt", "John")),
    (("acts", "praxapostolos"), ("Acts", "Acts")),
    (
        ("pauline epistles", "pauline epistle", "pauline letters", "paul", "pauline", "epistles of paul", "p"),
        ("Rom", "Heb"),
    ),
    (
        ("general epistles", "catholic epistles", "general letters", "catholic letters", "ce", "cath", "cath."),
        ("Jas", "Jude"),
    ),
    (("revelation", "apocalypse", "r", "book of revelation"), ("Rev", "Rev")),
    (("old testament", "ot", "bible", "whole bible", "greek bible", "entire greek bible"), ("Gen", "Mal")),
    (("pentateuch", "torah"), ("Gen", "Deut")),
    (("hexateuch",), ("Gen", "Josh")),
    (("heptateuch",), ("Gen", "Judg")),
    (("octateuch",), ("Gen", "Ruth")),
    (("minor prophets", "twelve prophets", "the twelve", "book of the twelve"), ("Hos", "Mal")),
    (("psalter",), ("Ps", "Ps")),
):
    for _n in _names:
        GROUPS[_n] = _span

_NEGATIVE = re.compile(r"\b(lacking|missing|except|without|lacunae?|lost)\b", re.I)
_FILLER = re.compile(
    r"\b(fragments?|frgs?|fragm|parts?|portions?|selections?|of|the|book|text|survived|only|incl|including|"
    r"contains?|small|large|with|commentary|catena|lectionary|some|few|and|most|almost|complete|entire|whole|on|"
    r"theophylact|zigabenus|nicetas|euthymius|diatessaron|scholia|greek|coptic|latin|gaps|lacunae)\b\.?",
    re.I,
)
_BOOK = alias_regex()
_CROSS = re.compile(
    rf"(?<![A-Za-z])({_BOOK})\.?\s*(\d+)\s*[:.,]\s*(\d+)\s*(?:-|–|—|to)\s*({_BOOK})\.?\s*(\d+)\s*[:.,]\s*(\d+)", re.I
)


def _book_span(first: str, last: str) -> tuple[int, int]:
    a, b = BY_OSIS[first].order, BY_OSIS[last].order
    if a > b:
        a, b = b, a
    return a * 1_000_000 + 1001, b * 1_000_000 + 999_999


def _valid(book: str, c1: int, c2: int) -> bool:
    chapters = BY_OSIS[book].chapters or 999
    return 1 <= c1 <= chapters and 1 <= c2 <= chapters


def _ranges(text: str, books_only: bool) -> tuple[list[tuple[int, int]], bool]:
    """Verse ranges in a contents text; the flag says whether any came from explicit chapter/verse references."""
    out: list[tuple[int, int]] = []
    explicit = False

    def cross(m: re.Match[str]) -> str:
        nonlocal explicit
        b1, b2 = resolve_book(m.group(1)), resolve_book(m.group(4))
        if b1 and b2 and b1 != b2:
            c1, v1, c2, v2 = (int(m.group(i)) for i in (2, 3, 5, 6))
            if _valid(b1, c1, c1) and _valid(b2, c2, c2):
                a = BY_OSIS[b1].order * 1_000_000 + c1 * 1000 + v1
                b = BY_OSIS[b2].order * 1_000_000 + c2 * 1000 + v2
                if a <= b:
                    out.append((a, b))
                    explicit = True
                    return " ; "
        return m.group(0)

    text = text.replace("†", " ")
    text = re.sub(r"(\d)[abc]\b", r"\1", text)  # half verses: '5:3a' → '5:3'
    text = re.sub(r"[-–—]\s*end\b", "-999:999", text)  # '3:6–end' → to the end of the book
    text = re.sub(r"\(\s*([\d:.,;\s–—-]+?)\s*\)", r" \1 ", text)  # 'John (7:6-9:23)' → 'John 7:6-9:23'
    if re.search(r"diatessaron|harmony|amulet|talisman|ostrac", text, re.I):
        books_only = False  # a gospel harmony or an amulet is not a copy of whole books
    text = _CROSS.sub(cross, text)
    for r in parse_refs(text):
        last = BY_OSIS[r.book].chapters or 999
        c2 = last if r.c2 == 999 else r.c2
        if not _valid(r.book, r.c1, c2):
            continue
        end = BY_OSIS[r.book].order * 1_000_000 + c2 * 1000 + (r.v2 if r.v2 else 999)
        if r.start <= end:
            out.append((r.start, end))
            explicit = True
    if books_only:
        cited = {r // 1_000_000 for r, _ in out}  # books given chapter and verse are not also taken whole
        for piece in re.split(r"[,;\n&()/]|\band\b|\+", text):
            p = piece.replace("†", " ").replace("*", " ").replace("?", " ").strip(" .:")
            if not p:
                continue
            stripped = " ".join(_FILLER.sub(" ", p).split()).strip(" .:")
            group = GROUPS.get(" ".join(p.lower().split())) or GROUPS.get(stripped.lower())
            book = resolve_book(p) or (resolve_book(stripped) if stripped else None)
            ends = [resolve_book(x.strip()) for x in re.split(r"\s*[-–—]\s*|\s+to\s+", stripped) if x.strip()]
            if group:
                out.append(_book_span(*group))
            elif book and BY_OSIS[book].order not in cited:
                out.append(_book_span(book, book))
            elif len(ends) == 2 and ends[0] and ends[1]:  # 'James – 3 John', '1 Timothy–Philemon'
                out.append(_book_span(ends[0], ends[1]))
    return out, explicit


def _before(k: int) -> int:
    """The verse key just before `k` (end of the previous chapter or book when `k` opens one)."""
    book, rest = divmod(k, 1_000_000)
    ch, v = divmod(rest, 1000)
    if v > 1:
        return k - 1
    if ch > 1:
        return book * 1_000_000 + (ch - 1) * 1000 + 999
    return (book - 1) * 1_000_000 + 999_999


def _after(k: int) -> int:
    """The verse key just after `k` (start of the next chapter or book when `k` closes one)."""
    book, rest = divmod(k, 1_000_000)
    ch, v = divmod(rest, 1000)
    if v < 999:
        return k + 1
    if ch < 999:
        return book * 1_000_000 + (ch + 1) * 1000 + 1
    return (book + 1) * 1_000_000 + 1001


def _subtract(ranges: list[tuple[int, int]], holes: list[tuple[int, int]]) -> list[tuple[int, int]]:
    for c, d in holes:
        nxt: list[tuple[int, int]] = []
        for a, b in ranges:
            if d < a or c > b:
                nxt.append((a, b))
                continue
            if a < c:
                nxt.append((a, _before(c)))
            if d < b:
                nxt.append((_after(d), b))
        ranges = [(a, b) for a, b in nxt if a <= b]
    return ranges


def merge(ranges: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


@dataclass
class Coverage:
    ranges: list[tuple[int, int]]
    partial: bool  # lacunae noted (†, 'lacking …') or contents given verse by verse


def coverage(contents: str, *, books_only: bool = True) -> Coverage:
    """Contents text (plain) → merged verse-key ranges, with lacking/missing clauses subtracted."""
    text = contents.replace("\n", "; ")
    text = re.sub(r"(?<=[a-z])[KSˢᴷ]+(?=[\s†,;()]|$)", "", text)  # text-form marks: 'GospelsK†' (Koine), 'LukeS'
    positive, negative = text, ""
    m = _NEGATIVE.search(text)
    if m:
        open_paren = text.rfind("(", 0, m.start())
        if open_paren > text.rfind(")", 0, m.start()):  # "(lacking 1 Timothy–Philemon)"
            close = text.find(")", m.end())
            close = len(text) if close < 0 else close
            negative = text[m.end() : close]
            positive = text[:open_paren] + text[close + 1 :]
        else:
            negative = text[m.end() :]
            positive = text[: m.start()]
    pos, explicit = _ranges(positive, books_only)
    neg, _ = _ranges(negative, books_only) if negative else ([], False)
    ranges = merge(_subtract(merge(pos), merge(neg)))
    return Coverage(ranges, partial="†" in text or bool(negative) or explicit)


# ============================================================================ records


@dataclass
class Manuscript:
    id: str
    sigla: str
    name: str | None
    collection: str
    language: str | None = "grc"
    format: str | None = None
    material: str | None = None
    date_label: str | None = None
    date: DateWindow | None = None
    script: str | None = None
    contents: str | None = None
    institution: str | None = None
    city: str | None = None
    country: str | None = None
    shelfmark: str | None = None
    discovered: str | None = None
    image_url: str | None = None
    description: str | None = None
    coverage: Coverage = field(default_factory=lambda: Coverage([], False))
    completeness: str = "partial"
    ids: dict[str, str] = field(default_factory=dict)  # external_id scheme → value


def _get(row: dict[str, str], *prefixes: str) -> str:
    for p in prefixes:
        for k, v in row.items():
            if k == p or k.startswith(p):
                return v
    return ""


def _institution(raw: str) -> tuple[str | None, str | None]:
    """'[[British Library]], Add. 43725' → ('British Library', 'Add. 43725')."""
    first = plain(raw, expand=True).split("\n")
    text = "; ".join(x.strip(" ;,") for x in first if x.strip(" ;,"))
    if not text:
        return None, None
    name, sep, shelf = text.partition(", ")
    return name.strip() or None, (shelf.strip() or None) if sep else None


def _extent(pages: str) -> str | None:
    p = one_line(pages, " ")
    if not p:
        return None
    if p.isdigit():
        return f"{p} leaves"
    return re.sub(r"\bFrg\b", "fragment" if p.startswith("1 ") else "fragments", p)


def _ga_wiki(raw: str) -> str | None:
    m = re.search(r"\{\{\s*Papyrus link\s*\|\s*(\d+)\s*(?:\|\s*([^}|]+?)\s*)?\}\}", raw, re.I)
    if m:
        return m.group(2) or f"Papyrus {m.group(1)}"
    return first_link(raw)


def nt_rows(text: str, kind: str) -> Iterator[Manuscript]:
    """Rows of a Gregory–Aland list (papyri, uncials or minuscules)."""
    for t in tables(clean_source(text)):
        if not t.header or not any(h in ("#", "name") for h in t.header):
            continue
        for row in t.rows:
            raw_no = row.get("#") or row.get("name") or ""
            number = plain(raw_no, sup=False).split("\n")[0].strip()
            number = number.replace("𝔓", "P").replace(" ", "")
            if kind == "papyri":
                m = re.fullmatch(r"P?(\d+)", number)
                number = f"P{m.group(1)}" if m else ""
            elif kind == "uncials":
                number = number if re.fullmatch(r"0\d{1,4}", number) else ""
            else:
                number = number if re.fullmatch(r"[1-9]\d{0,4}", number) else ""
            if not number:
                continue
            wiki: str | None
            if kind == "minuscules":
                wiki = first_link(raw_no)
                if not wiki:  # notable minuscules only: those with their own article
                    continue
            elif kind == "uncials" and "name" in row:
                wiki = first_link(row["name"])
            else:
                wiki = _ga_wiki(raw_no)
            date_label = one_line(_get(row, "date"), " ")
            contents = one_line(re.sub(r"<sup>.*?</sup>", "", _get(row, "content"), flags=re.I))
            if not date_label and not contents:
                continue
            institution, shelf = _institution(_get(row, "institution"))
            ref_no = one_line(_get(row, "ref"), "; ")
            if kind == "papyri" and ref_no:
                shelf = ref_no
            city = one_line(_get(row, "city"), ", ") or None
            if kind == "papyri" and city:
                city = city.split(",")[0]
            sign = plain(row.get("sign", "")).strip()
            name = wiki if kind != "papyri" else (wiki or f"Papyrus {number[1:]}")
            if kind == "uncials" and not wiki:
                name = f"Uncial {number}"
            cov = coverage(contents)
            yield Manuscript(
                id=f"GA:{number}",
                sigla=f"{number} {sign}".strip() if kind == "uncials" else number,
                name=name,
                collection=COLLECTIONS[kind],
                format="codex",
                material="papyrus" if kind == "papyri" else ("parchment" if kind == "uncials" else None),
                date_label=date_label or None,
                date=parse_date(date_label),
                contents=contents or None,
                institution=institution,
                city=city,
                country=one_line(_get(row, "country"), ", ") or None,
                shelfmark=shelf,
                description=_extent(_get(row, "pages")),
                coverage=cov,
                completeness="fragmentary" if kind == "papyri" else ("partial" if cov.partial else "full"),
                ids={"ga": number, **({"wikipedia": wiki} if wiki else {})},
            )


def lxx_rows(text: str) -> Iterator[Manuscript]:
    """Septuagint manuscripts: the lettered codices (Rahlfs A–Z) and numbered witnesses written before AD 600."""
    for t in tables(clean_source(text)):
        if "symbol" not in t.header:
            continue
        for row in t.rows:
            symbol = plain(row.get("symbol", ""), sup=False).split("\n")[0].strip()
            if not symbol or len(symbol) > 12 or symbol[0] in "[{(":  # bracketed numbers are withdrawn
                continue
            raw_name = row.get("name", "")
            wiki = first_link(raw_name)
            name = plain(raw_name).split("\n")[0].strip() or None
            if wiki and re.fullmatch(r"\d+Q\d+\w*", wiki):  # Qumran Greek scrolls come from the DSS list
                continue
            date_label = one_line(row.get("date", ""), " ")
            date = parse_date(date_label)
            numbered = symbol[0].isdigit()
            if numbered and (date is None or date.hi > 600):
                continue
            contents = one_line(row.get("content", ""))
            institution, shelf = _institution(row.get("institution", ""))
            sid = re.sub(r"[^\w.-]", "", symbol) or symbol
            text_all = f"{name or ''} {shelf or ''}"
            yield Manuscript(
                id=f"LXX:{sid}",
                sigla=symbol,
                name=wiki or name or f"Rahlfs {symbol}",
                collection=COLLECTIONS["lxx"],
                material="papyrus" if re.search(r"\bpap|papyr|\bP\.", text_all, re.I) else None,
                date_label=date_label or None,
                date=date,
                contents=contents or None,
                institution=institution,
                city=one_line(row.get("city", ""), ", ") or None,
                country=one_line(row.get("country", ""), ", ") or None,
                shelfmark=shelf,
                coverage=coverage(lxx_books(contents)),
                ids={"rahlfs": symbol, **({"wikipedia": wiki} if wiki else {})},
            )


_LXX_BOOKS = (  # Rahlfs-style Latin book names used in the Septuagint list
    (r"\bReg(?:n)?\.?\s*IV\b", "2 Kings"),
    (r"\bReg(?:n)?\.?\s*III\b", "1 Kings"),
    (r"\bReg(?:n)?\.?\s*II\b", "2 Samuel"),
    (r"\bReg(?:n)?\.?\s*I\b", "1 Samuel"),
    (r"\bPar\.?\s*II\b", "2 Chronicles"),
    (r"\bPar\.?\s*I\b", "1 Chronicles"),
    (r"\bSap\.?", "Wisdom"),
    (r"\bDan\.?\s*(?:o\'|θ\'|Th\.?)", "Daniel"),
    (r"\bEzechiel\b", "Ezekiel"),
    (r"\bEster\b", "Esther"),
    (r"\b1, 2, 3 Kings\b", "1 Samuel – 1 Kings"),
)


def lxx_books(text: str) -> str:
    for pattern, name in _LXX_BOOKS:
        text = re.sub(pattern, name, text)
    return text


_LANGS = {"hebrew": "hbo", "aramaic": "arc", "greek": "grc", "nabataean": "nbat", "latin": "lat"}


def dss_rows(text: str) -> Iterator[Manuscript]:
    """The Dead Sea Scrolls list: Qumran caves 1–11, Wadi Murabba'at, Nahal Hever, Masada."""
    seen: set[str] = set()
    for t in tables(clean_source(text)):
        if not any(h.startswith("fragment or scroll identifier") for h in t.header):
            continue
        for row in t.rows:
            raw_id = _get(row, "fragment or scroll identifier")
            siglum = plain(raw_id).split("\n")[0].strip()
            alt = plain(_get(row, "alternative identifier"), sup=False).split("\n")[0].strip()
            ascii_id = re.sub(r"[^A-Za-z0-9.-]", "", plain(raw_id, sup=False).split("\n")[0].split("/")[0])
            ascii_id = ascii_id or re.sub(r"[^A-Za-z0-9.-]", "", alt)
            if not ascii_id:
                continue
            mid = f"DSS:{ascii_id}"
            if mid in seen:  # the same siglum twice: tell them apart by the Qumran number, else by position
                alt_id = re.sub(r"[^A-Za-z0-9.-]", "", alt)
                n = 2
                mid = f"DSS:{ascii_id}-{alt_id}" if alt_id and len(alt_id) <= 12 else f"DSS:{ascii_id}-{n}"
                while mid in seen:
                    n += 1
                    mid = f"DSS:{ascii_id}-{n}"
            bible = one_line(_get(row, "english bible association"))
            name = one_line(_get(row, "fragment or scroll name"), " ") or None
            if not bible and re.search(r"unidentified", f"{name} {siglum}", re.I):
                continue  # unidentified fragments say nothing about any text
            seen.add(mid)
            date_label = one_line(_get(row, "date"), " ")
            language = one_line(_get(row, "language"), " ")
            lang_code = next((code for word, code in _LANGS.items() if word in language.lower()), None)
            hand = scripts(f"{date_label} {language} {siglum}")
            yield Manuscript(
                id=mid,
                sigla=siglum or alt,
                name=name,
                collection=COLLECTIONS["dss"],
                language=lang_code,
                format="scroll",
                material="papyrus" if re.search(r"pap", siglum, re.I) else "parchment",
                date_label=date_label or None,
                date=parse_date(date_label),
                script=hand,
                contents=bible or None,
                discovered=t.heading or None,
                image_url=leon_url(row.values()),
                description=one_line(_get(row, "description"), " ") or None,
                coverage=coverage(bible, books_only=False),
                completeness="fragmentary",
                ids={
                    **({"dss": alt} if alt and alt != siglum else {}),
                    **({"wikipedia": w} if (w := first_link(raw_id)) else {}),
                },
            )


# ============================================================================ storing


def _store(ctx: Context, items: Iterable[Manuscript], source: str) -> tuple[int, int]:
    con = ctx.con
    n_ms = n_cov = 0
    for ms in items:
        d = ms.date
        con.execute(
            "INSERT INTO manuscript (id, sigla, name, collection, language, format, material, date_from, date_to, "
            "date_label, script, contents, institution, city, country, shelfmark, discovered, image_url, description, "
            "source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ms.id,
                ms.sigla,
                ms.name,
                ms.collection,
                ms.language,
                ms.format,
                ms.material,
                d.lo if d else None,
                d.hi if d else None,
                ms.date_label,
                ms.script,
                ms.contents,
                ms.institution,
                ms.city,
                ms.country,
                ms.shelfmark,
                ms.discovered,
                ms.image_url,
                ms.description,
                source,
            ),
        )
        n_ms += 1
        if d:
            kind = "point" if d.lo == d.hi else "window"
            con.execute(
                "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, "
                "precision, circa, label, basis, source_id) VALUES ('manuscript',?,'when',?,?,?,?,?,?,?,?,?)",
                (ms.id, SYSTEM, kind, d.lo, d.hi, precision(d.lo, d.hi), int(d.circa), ms.date_label, d.basis, source),
            )
        n_cov += _insert_coverage(ctx, ms.id, ms.coverage.ranges, ms.completeness, source)
        _insert_ids(ctx, ms.id, ms.ids)
    return n_ms, n_cov


def _insert_coverage(ctx: Context, ms_id: str, ranges: list[tuple[int, int]], completeness: str, source: str) -> int:
    return ctx.insert(
        "manuscript_coverage",
        ("manuscript_id", "start_vkey", "end_vkey", "completeness", "source_id"),
        ((ms_id, a, b, completeness, source) for a, b in ranges),
    )


def _insert_ids(ctx: Context, ms_id: str, ids: dict[str, str]) -> None:
    ctx.insert(
        "external_id",
        ("entity_type", "entity_id", "scheme", "value"),
        (("manuscript", ms_id, scheme, value) for scheme, value in ids.items() if value),
        mode="OR IGNORE",
    )


def _clear(ctx: Context, source: str) -> None:
    ids = "SELECT id FROM manuscript WHERE source_id = ?"
    ctx.con.execute(f"DELETE FROM external_id WHERE entity_type = 'manuscript' AND entity_id IN ({ids})", (source,))
    ctx.con.execute(f"DELETE FROM dating WHERE entity_type = 'manuscript' AND entity_id IN ({ids})", (source,))
    ctx.clear(source, "manuscript_coverage", "manuscript")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


NT_START = BY_OSIS["Matt"].order * 1_000_000
NT_END = (BY_OSIS["Rev"].order + 1) * 1_000_000


def _join(*values: str | None) -> str | None:
    seen = list(dict.fromkeys(v for v in values if v))
    return "; ".join(seen) or None


def _absorb(into: Manuscript, other: Manuscript) -> None:
    """Fold a second row of the same manuscript (another part, kept elsewhere) into the first."""
    if other.contents == into.contents and other.institution == into.institution:
        return  # the same row again (a second line of image links)
    into.coverage = Coverage(merge([*into.coverage.ranges, *other.coverage.ranges]), True)
    into.contents = _join(into.contents, other.contents)
    if other.institution != into.institution:  # 'Chester Beatty Library (Dublin); University of Michigan (Ann Arbor)'
        here = f"{into.institution} ({into.city})" if into.city and into.institution else into.institution
        there = f"{other.institution} ({other.city})" if other.city and other.institution else other.institution
        into.institution = _join(here, there)
        into.city = None
        into.country = _join(into.country, other.country)
    into.shelfmark = _join(into.shelfmark, other.shelfmark)
    leaves = [re.fullmatch(r"(\d+) leaves", d or "") for d in (into.description, other.description)]
    if leaves[0] and leaves[1]:  # parts in two libraries: 56 + 30 leaves
        into.description = f"{int(leaves[0].group(1)) + int(leaves[1].group(1))} leaves"
    else:
        into.description = _join(into.description, other.description)


@step("manuscripts", sources=[SOURCE], requires=["curated"])
def ingest_manuscripts(ctx: Context) -> None:
    """New Testament papyri, uncials and notable minuscules, and Septuagint codices from Wikipedia's lists."""
    _clear(ctx, SOURCE)
    nt: list[Manuscript] = []
    nt.extend(nt_rows(_read(ctx.find(SOURCE, "nt-papyri.wiki")), "papyri"))
    nt.extend(nt_rows(_read(ctx.find(SOURCE, "nt-uncials.wiki")), "uncials"))
    minuscule_pages = sorted(p for p in ctx.paths(SOURCE) if p.name.startswith("nt-minuscules-"))
    for page in minuscule_pages:
        nt.extend(nt_rows(_read(page), "minuscules"))
    by_id: dict[str, Manuscript] = {}
    for ms in nt:  # a manuscript listed over several rows (image links, or parts kept in different libraries)
        if ms.id in by_id:
            _absorb(by_id[ms.id], ms)
        else:
            by_id[ms.id] = ms
    if len([m for m in by_id.values() if m.collection == COLLECTIONS["papyri"]]) < MIN_PAPYRI:
        raise IngestError("NT papyri list parsed to fewer than 100 rows — has the page layout changed?")
    by_wiki = {ms.ids["wikipedia"]: ms for ms in by_id.values() if ms.ids.get("wikipedia")}
    lxx: list[Manuscript] = []
    for ms in lxx_rows(_read(ctx.find(SOURCE, "lxx-manuscripts.wiki"))):
        twin = by_wiki.get(ms.ids.get("wikipedia", ""))
        if twin is not None:  # Codex Sinaiticus = GA 01 = Rahlfs S: one manuscript, both testaments
            ot = [(a, min(b, NT_START - 1)) for a, b in ms.coverage.ranges if a < NT_START]
            ot += [(a, b) for a, b in ms.coverage.ranges if a >= NT_END]  # deuterocanon (after the NT in hub order)
            twin.coverage = Coverage(merge([*twin.coverage.ranges, *ot]), True)
            twin.completeness = "partial"
            twin.ids["rahlfs"] = ms.sigla
            if ms.contents:
                twin.description = "; ".join(x for x in (twin.description, f"Old Testament: {ms.contents}") if x)
            continue
        if ms.id not in by_id and all(ms.id != o.id for o in lxx):
            lxx.append(ms)
    n_ms, n_cov = _store(ctx, [*by_id.values(), *lxx], SOURCE)
    ctx.log.info("  %d manuscripts (%d LXX), %d coverage ranges", n_ms, len(lxx), n_cov)


@step("dead-sea-scrolls", sources=[DSS_SOURCE], requires=["curated"])
def ingest_dss(ctx: Context) -> None:
    """Dead Sea Scrolls (Qumran, Murabba'at, Nahal Hever, Masada) with the biblical passages each preserves."""
    _clear(ctx, DSS_SOURCE)
    rows = list(dss_rows(_read(ctx.find(DSS_SOURCE, "dead-sea-scrolls.wiki"))))
    if len(rows) < MIN_SCROLLS:
        raise IngestError(f"Dead Sea Scrolls list parsed to only {len(rows)} rows — has the page layout changed?")
    n_ms, n_cov = _store(ctx, rows, DSS_SOURCE)
    ctx.log.info("  %d scrolls, %d coverage ranges", n_ms, n_cov)
