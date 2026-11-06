"""Manuscript transcriptions: what the earliest Greek New Testament manuscripts actually read, verse by verse.

Source: the Center for New Testament Restoration's electronic transcriptions (Alan Bunning, CC BY-SA 4.0), one file
per manuscript in the Manuscript Encoding Specification (MES): ``43001018 /=θν ουδεισ εωρακεν πωποται μο%/νογενησ``.
Each file becomes an ``edition`` of kind 'manuscript' (``cntr:P66``) linked to the catalogue's ``manuscript`` row
(``GA:P66``) by its Gregory–Aland number, with one ``edition_verse`` per verse:

* ``text``   — the verse as the manuscript reads it, plain letters (supplied letters included, nomina sacra as the
  scribe abbreviated them, the nu-stroke written out), for search and comparison;
* ``markup`` — light HTML keeping what the transcription marks (see :func:`render`):

  ``<span class="w">…</span>``                 a word; extra classes ``ns`` (nomen sacrum, written with an overline),
                                               ``num`` (letter numeral), ``sup`` (word lost in a lacuna and supplied
                                               by the editor), ``vid`` (supplied, its presence inferred from the space)
  ``<span class="m">…</span>``                 letters lost in a lacuna (supplied)
  ``<span class="d">…</span>``                 damaged letters (partly visible)
  ``<span class="nu">¯</span>``                the stroke for a final nu
  ``<span class="lig">μου</span>``             a ligature, written out
  ``<span class="gap"></span>``                text lost and not supplied (``gap v``: the rest of the verse)
  ``<span class="lb|cb|pb"></span>``           line, column and page breaks (``data-n``: the number the source gives)
  ``<span class="corr" data-x data-a …>``      a correction: the scribe's final text inside; ``data-x`` what the
                                               first hand wrote before correcting, ``data-a``/``data-b``/``data-c``
                                               the second, third and fourth hands' readings
  ``<span class="absent"></span>``             the manuscript does not have this verse (``absent vid``: inferred
                                               from the space in a lacuna; ``text`` is then empty)

Verses that the manuscript is only presumed to have had, wholly lost (MES ``+~``), are not stored. Images are never
copied.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..books import BOOKS
from ..refs import key_to_parts, vkey
from .base import Context, IngestError, step

SOURCE = "cntr"
FOLDER = "class 1"
#: Sanity floor: fewer transcribed manuscripts means the checkout is incomplete (tests lower it).
MIN_MANUSCRIPTS = 100
SORT_BASE = 500  # after translations and word editions; manuscript editions are not offered as reading texts

#: MES book numbers: 40 = Matthew … 66 = Revelation (the Protestant canon order).
MES_BOOK = {40 + i: b.osis for i, b in enumerate(b for b in BOOKS if b.testament == "NT")}

LETTERS = set("αβγδεζηθικλμνξοπρσςτυφχψω") | {
    "¯",  # macron: the stroke for a final nu (or a numeral's overline)
    "ϛ",  # stigma
    "ϟ",  # koppa
    "⳨",  # staurogram
    "ϗ",  # kai compendium
    "͵",  # lower numeral sign
    "�",  # an illegible letter
}
LIGATURES = {"": "μου"}  # private-use ligature glyphs, written out
BREAKS = {"\\": "pb", "|": "cb", "/": "lb"}
HANDS = {"x": "first hand", "a": "second hand", "b": "third hand", "c": "fourth hand"}
_LINE = re.compile(r"^(\d{2})(\d{3})(\d{3}) (.*)$")
_SEGMENT = re.compile(r"([xabc]?)\{([^{}]*)\}|(\S+)")


@dataclass
class Word:
    """One word: runs of letters ('l' plain, 'd' damaged, 'm' missing, 'lig' ligature) and breaks/gaps between."""

    pieces: list[tuple[str, str]] = field(default_factory=list)
    ns: bool = False  # nomen sacrum (=)
    num: bool = False  # letter numeral ($)
    supplied: bool = False  # ~ : lost in a lacuna, supplied by the editor
    vid: bool = False  # + : supplied, presence inferred from the space
    absent: bool = False  # - : judged absent

    def letters(self) -> str:
        return "".join(v for k, v in self.pieces if k in ("l", "d", "m", "lig"))

    @property
    def lost(self) -> bool:
        """No letter of the word survives."""
        return self.supplied or self.vid or all(k == "m" for k, _ in self.pieces if k in ("l", "d", "m", "lig"))


@dataclass
class Correction:
    """A place a later hand (or the scribe) changed: the final reading plus the earlier/later ones."""

    text: list[Word] | None = None  # {…}: the manuscript's text (the scribe's, after his own corrections)
    hands: dict[str, list[Word]] = field(default_factory=dict)  # 'x' first written, 'a' 'b' 'c' later hands


Segment = Word | Correction


@dataclass
class Verse:
    book: str
    chapter: int
    verse: int
    segments: list[Segment] = field(default_factory=list)
    status: str = ""  # '' | 'absent' | 'absent-vid' | 'lost'


# ----------------------------------------------------------------------------- parsing


def parse_word(token: str) -> Word:
    """One MES word, e.g. '=θν', 'μο%/νογενησ', 'αυ^τ^ο^υ^', '~λογοσ', '\\522βιβλοσ', 'αμην/36|3'."""
    w = Word()
    i, n = 0, len(token)

    def add(kind: str, text: str) -> None:
        if w.pieces and w.pieces[-1][0] == kind and kind in ("l", "d", "m"):
            w.pieces[-1] = (kind, w.pieces[-1][1] + text)
        else:
            w.pieces.append((kind, text))

    while i < n:
        c = token[i]
        if c in BREAKS or c == "⋄":
            j = i + 1
            while j < n and token[j].isdigit():
                j += 1
            if c != "⋄":  # alternate verse division: the verse order is kept by the reference
                w.pieces.append((BREAKS[c], token[i + 1 : j]))
            i = j
            continue
        if c == "&":
            w.pieces.append(("gap", "line"))
        elif c == "*":
            w.pieces.append(("gap", "verse"))
        elif c == "+":
            w.vid = True
        elif c == "-":
            w.absent = True
        elif c == "~":
            w.supplied = True
        elif c == "=":
            w.ns = True
        elif c == "$":
            w.num = True
        elif c in "_[]":
            pass  # altered word division / questionable text: not used in the class 1 files
        elif c in LIGATURES:
            w.pieces.append(("lig", LIGATURES[c]))
        elif c in LETTERS:
            cond = token[i + 1] if i + 1 < n else ""
            if cond == "%":
                add("d", c)
                i += 1
            elif cond == "^":
                add("m", c)
                i += 1
            else:
                add("l", c)
        else:
            raise IngestError(f"unexpected character {c!r} in MES word {token!r}")
        i += 1
    return w


def parse_words(text: str) -> list[Word]:
    return [parse_word(t) for t in text.split()]


def parse_body(body: str) -> tuple[list[Segment], str]:
    """A verse's MES text → segments, and the verse status ('absent', 'absent-vid', 'lost' or '')."""
    body = body.strip()
    if body in ("-", "-~", "+~"):
        return [], {"-": "absent", "-~": "absent-vid", "+~": "lost"}[body]
    segments: list[Segment] = []
    corr: Correction | None = None
    for m in _SEGMENT.finditer(body):
        hand, inner, word = m.groups()
        if word is not None:
            corr = None
            segments.append(parse_word(word))
            continue
        words = parse_words(inner)
        if hand == "x" or (hand == "" and (corr is None or corr.text is not None)) or (corr is None):
            corr = Correction()
            segments.append(corr)
        if hand == "":
            corr.text = words
        else:
            corr.hands[hand] = words
    for s in segments:
        if isinstance(s, Correction) and s.text is None:
            s.text = []
    return segments, ""


def parse_file(path: Path) -> list[Verse]:
    """Every verse of one transcription file; a verse given twice (a scribe's repetition) is joined in order."""
    verses: dict[tuple[int, int, int], Verse] = {}
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        m = _LINE.match(line)
        if not m:
            raise IngestError(f"{path.name}:{line_no}: not an MES line: {line[:60]!r}")
        b, c, v = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if b not in MES_BOOK:
            raise IngestError(f"{path.name}:{line_no}: unknown MES book number {b}")
        segments, status = parse_body(m.group(4))
        key = (b, c, v)
        if key in verses:
            prev = verses[key]
            prev.segments.extend(segments)
            if segments:
                prev.status = ""
        else:
            verses[key] = Verse(MES_BOOK[b], c, v, segments, status)
    return list(verses.values())


# ----------------------------------------------------------------------------- output


def _final_words(segments: list[Segment]) -> list[Word]:
    """The words of the manuscript's text, corrections resolved to the scribe's final reading."""
    out: list[Word] = []
    for s in segments:
        if isinstance(s, Correction):
            out.extend(s.text or [])
        else:
            out.append(s)
    return out


def plain(segments: list[Segment]) -> str:
    """Letters of every word (supplied ones included), nomina sacra as written, the nu-stroke as ν."""
    words = [w.letters().replace("¯", "ν") for w in _final_words(segments)]
    return " ".join(w for w in words if w)


def leiden(words: list[Word]) -> str:
    """Words in Leiden-style plain text: [lost letters], damaged letters with a dot below, nomina sacra overlined."""
    out: list[str] = []
    for w in words:
        if w.lost and (w.supplied or w.vid):
            out.append(f"[{w.letters()}]" if w.letters() else "[…]")
            continue
        s = ""
        for kind, text in w.pieces:
            if kind == "m":
                s += f"[{text}]"
            elif kind == "d":
                s += "".join(ch + "̣" for ch in text)
            elif kind in ("l", "lig"):
                s += text
            elif kind == "gap":
                s += "[…]"
        if w.ns or w.num:
            s = "".join(ch + "̅" if ch not in "[]̣" else ch for ch in s)
        out.append(s.replace("�", "·").replace("¯", "(ν)").replace("][", ""))
    return " ".join(x for x in out if x)


def _attr(text: str) -> str:
    return html.escape(text, quote=True)


def _letters_html(text: str) -> str:
    return html.escape(text).replace("¯", '<span class="nu">¯</span>').replace("�", "·")


def _word_html(w: Word) -> str:
    pieces = w.pieces
    first = next((i for i, (k, _) in enumerate(pieces) if k in ("l", "d", "m", "lig")), len(pieces))
    last = max((i for i, (k, _) in enumerate(pieces) if k in ("l", "d", "m", "lig")), default=-1)

    def piece(kind: str, text: str) -> str:
        if kind == "l":
            return _letters_html(text)
        if kind in ("d", "m"):
            return f'<span class="{kind}">{_letters_html(text)}</span>'
        if kind == "lig":
            return f'<span class="lig">{html.escape(text)}</span>'
        if kind == "gap":
            return '<span class="gap v"></span>' if text == "verse" else '<span class="gap"></span>'
        n = f' data-n="{text}"' if text else ""
        return f'<span class="{kind}"{n}></span>'

    before = "".join(piece(*p) for p in pieces[:first])
    after = "".join(piece(*p) for p in pieces[last + 1 :]) if last >= 0 else ""
    if last < 0:
        return before
    classes = ["w"]
    if w.ns:
        classes.append("ns")
    if w.num:
        classes.append("num")
    if w.supplied or w.vid:
        classes.append("sup")
    if w.vid:
        classes.append("vid")
    inner = "".join(piece(*p) for p in pieces[first : last + 1])
    return f'{before}<span class="{" ".join(classes)}">{inner}</span>{after}'


def render(segments: list[Segment], status: str = "") -> str:
    """The light-HTML markup of a verse (see the module docstring)."""
    if status in ("absent", "absent-vid"):
        return '<span class="absent vid"></span>' if status == "absent-vid" else '<span class="absent"></span>'
    out: list[str] = []
    for s in segments:
        if isinstance(s, Word):
            out.append(_word_html(s))
            continue
        attrs = "".join(
            f' data-{hand}="{_attr(leiden(words) or "—")}"' for hand, words in sorted(s.hands.items(), key=_hand_order)
        )
        inner = " ".join(x for x in (_word_html(w) for w in s.text or []) if x)
        out.append(f'<span class="corr{"" if inner else " empty"}"{attrs}>{inner}</span>')
    return " ".join(x for x in out if x)


def _hand_order(item: tuple[str, list[Word]]) -> int:
    return list(HANDS).index(item[0])


# ----------------------------------------------------------------------------- step


@step("transcriptions", sources=[SOURCE], requires=["manuscripts", "verses"])
def ingest_transcriptions(ctx: Context) -> None:
    """Manuscript transcriptions (CNTR): the text of 120+ early Greek NT manuscripts verse by verse, as written."""
    folder = ctx.find(SOURCE, FOLDER)
    files = sorted(folder.glob("*.txt"))
    if len(files) < MIN_MANUSCRIPTS:
        raise IngestError(f"{SOURCE}: only {len(files)} transcriptions in {folder} — is the checkout complete?")
    ctx.con.execute(
        "DELETE FROM edition_verse WHERE edition_id IN (SELECT id FROM edition WHERE source_id = ?)", (SOURCE,)
    )
    ctx.clear(SOURCE, "edition")
    known = {
        r[0]: r[1:]
        for r in ctx.con.execute("SELECT id, sigla, name, date_from, date_to FROM manuscript WHERE id LIKE 'GA:%'")
    }
    hub = {r[0] for r in ctx.con.execute("SELECT vkey FROM verse")}
    found = []
    for path in files:
        ms_id = f"GA:{path.stem}"
        if ms_id not in known:
            ctx.log.warning("  %s: no catalogue entry for %s — transcription skipped", SOURCE, ms_id)
            continue
        found.append((path, ms_id))
    # earliest first, so the editions read in date order wherever they are listed
    found.sort(key=lambda f: (known[f[1]][2] is None, known[f[1]][2] or 0, known[f[1]][3] or 0, f[1]))
    n_verses = n_absent = 0
    unmapped: list[str] = []
    for sort, (path, ms_id) in enumerate(found, start=SORT_BASE):
        sigla, name, *_ = known[ms_id]
        ga = path.stem
        edition_id = f"cntr:{ga}"
        rows: dict[int, tuple[str, str, str | None]] = {}
        for v in parse_file(path):
            if v.status == "lost":
                continue
            k, native = _hub_key(v, hub)
            if k is None:
                unmapped.append(f"{ga} {v.book}.{v.chapter}.{v.verse}")
                continue
            text, markup = plain(v.segments), render(v.segments, v.status)
            if k in rows:  # a verse numbered differently in the hub (e.g. 3 John 15 → 14): join to its hub verse
                t0, m0, n0 = rows[k]
                text, markup, native = f"{t0} {text}".strip(), f"{m0} {markup}", n0 or native
            rows[k] = (text, markup, native)
        if not rows:
            continue
        ctx.insert(
            "edition",
            [
                "id",
                "title",
                "abbrev",
                "language",
                "kind",
                "testament",
                "versification_id",
                "manuscript_id",
                "description",
                "sort",
                "source_id",
            ],
            [
                (
                    edition_id,
                    f"{name or sigla or ga} — transcription",
                    ga,
                    "grc",
                    "manuscript",
                    "NT",
                    "eng",
                    ms_id,
                    "Transcription by the Center for New Testament Restoration (Alan Bunning), CC BY-SA 4.0: "
                    "lacunae, supplied and damaged letters, nomina sacra and corrections as the manuscript has them.",
                    sort,
                    SOURCE,
                )
            ],
        )
        ctx.insert(
            "edition_verse",
            ["edition_id", "vkey", "native_ref", "text", "markup"],
            ((edition_id, k, native, text, markup) for k, (text, markup, native) in sorted(rows.items())),
        )
        n_verses += len(rows)
        n_absent += sum(1 for _, (t, m, _n) in rows.items() if m.startswith('<span class="absent'))
    if unmapped:
        ctx.log.warning("  %d verses with no hub verse: %s", len(unmapped), ", ".join(unmapped[:12]))
    ctx.meta("transcriptions.manuscripts", str(len(found)))
    ctx.meta("transcriptions.verses", str(n_verses))
    ctx.log.info(
        "  %d manuscripts transcribed, %d verses (%d marked absent); %d files without a catalogue entry",
        len(found),
        n_verses,
        n_absent,
        len(files) - len(found),
    )


def _hub_key(v: Verse, hub: set[int]) -> tuple[int | None, str | None]:
    """Hub verse key for a transcription verse. The Greek numbering differs from the KJV hub only at a few verse
    ends (3 John 15, Rev 12:18, 2 Cor 13:13 …): such a verse is joined to the last hub verse of its chapter."""
    k = vkey(v.book, v.chapter, v.verse)
    if k in hub:
        return k, None
    native = f"{v.book}.{v.chapter}.{v.verse}"
    prev = max((h for h in hub if k - v.verse < h < k), default=None)
    if prev is None:
        return None, native
    b, c, _ = key_to_parts(prev)
    return (prev, native) if (b, c) == (v.book, v.chapter) else (None, native)
