"""Philo of Alexandria in C. D. Yonge's translation (London: Bohn, 1854–55, four volumes, public domain), from the
Internet Archive's OCR text of the University of Toronto copies.

The text is cleaned of the printed page furniture (running heads, page numbers, printer's signatures), lines broken
by the press are joined again, and each treatise is cut into its numbered sections (I., II., …). Yonge's footnotes
are not shown (their Greek did not survive the OCR), but the Scripture they cite ("Genesis ii. 4") is kept: each
reference links the section to that verse, as the editors' notes do for Josephus.

Treatises are found by a curated table of headings, in order: a treatise's title also runs along the top of its
pages, so only its first appearance after the previous treatise is its heading.
"""

# ruff: noqa: E501  (the treatise table below is data, one treatise to a line, easier to check than if wrapped)

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path

from .base import IngestError
from .ccel import Section

SOURCE = "philo-yonge"
AUTHOR = "philo-of-alexandria"


@dataclass(frozen=True)
class Treatise:
    vol: int
    id: str  # work id
    title: str
    latin: str
    heading: str  # regex on a heading line, normalised to capital letters and single spaces
    book: int | None = None  # a book of a work in several (its sections are cited "2.14")
    dates: tuple[int, int] = (20, 50)
    qa: bool = False  # questions and answers: each question stands before its numbered answer


# fmt: off
TREATISES: list[Treatise] = [
    Treatise(1, "philo.opificio", "On the Creation of the World", "De opificio mundi", r"CREATION OF THE [VW]ORLD"),
    Treatise(1, "philo.legum-allegoriae", "Allegorical Interpretation", "Legum allegoriae", r"^THE FIRST BOOK$", 1),
    Treatise(1, "philo.legum-allegoriae", "Allegorical Interpretation", "Legum allegoriae", r"^THE SECOND BOOK$", 2),
    Treatise(1, "philo.legum-allegoriae", "Allegorical Interpretation", "Legum allegoriae", r"^THE THIRD BOOK$", 3),
    Treatise(1, "philo.cherubim", "On the Cherubim", "De cherubim", r"TREATISE ON THE CHERUBIM"),
    Treatise(1, "philo.sacrificiis", "On the Sacrifices of Abel and Cain", "De sacrificiis Abelis et Caini", r"SACRIFICES OF ABEL A[NS]D CAIN"),
    Treatise(1, "philo.deterius", "That the Worse Attacks the Better", "Quod deterius potiori insidari soleat", r"THAT THE WORSE IS ACCUSTOMED"),
    Treatise(1, "philo.posteritate", "On the Posterity of Cain", "De posteritate Caini", r"ON THE POSTERITY OF CAIN"),
    Treatise(1, "philo.gigantibus", "On the Giants", "De gigantibus", r"TREATISE ON THE GIANTS"),
    Treatise(1, "philo.deus", "On the Unchangeableness of God", "Quod Deus sit immutabilis", r"[TU]?[JN]?CHANGEABLE"),
    Treatise(1, "philo.agricultura", "On Husbandry", "De agricultura", r"TILLING OF THE EARTH BY NOAH"),
    Treatise(1, "philo.plantatione", "On Planting", "De plantatione", r"PLANTING OF NOAH"),
    Treatise(1, "philo.ebrietate", "On Drunkenness", "De ebrietate", r"TREATISE ON DRUNKENNESS"),
    Treatise(1, "philo.sobrietate", "On Sobriety", "De sobrietate", r"NOAH AWOKE FROM HIS WINE"),
    Treatise(2, "philo.confusione", "On the Confusion of Tongues", "De confusione linguarum", r"CONFUSION OF LANGUAGES"),
    Treatise(2, "philo.migratione", "On the Migration of Abraham", "De migratione Abrahami", r"MIGRATION OF ABRAHAM"),
    Treatise(2, "philo.heres", "Who Is the Heir of Divine Things", "Quis rerum divinarum heres sit", r"HEIR OF DIVINE THINGS"),
    Treatise(2, "philo.congressu", "On Mating with the Preliminary Studies", "De congressu eruditionis gratia", r"SEEKING INSTRUCTION"),
    Treatise(2, "philo.fuga", "On Flight and Finding", "De fuga et inventione", r"TREATISE ON FUGITIVES"),
    Treatise(2, "philo.mutatione", "On the Change of Names", "De mutatione nominum", r"CERTAIN NAMES IN THE HOLY SCRIPTURES"),
    Treatise(2, "philo.somniis", "On Dreams", "De somniis", r"DREAMS ARE SENT FROM GOD", 1),
    Treatise(2, "philo.somniis", "On Dreams", "De somniis", r"DREAMS ARE SENT FROM GOD", 2),
    Treatise(2, "philo.abrahamo", "On Abraham", "De Abrahamo", r"UNWRITTEN LAW"),
    Treatise(2, "philo.iosepho", "On Joseph", "De Iosepho", r"OR ON JOSEPH"),
    Treatise(3, "philo.vita-mosis", "On the Life of Moses", "De vita Mosis", r"PROPHETIC OFFICE OF MOSES", 1),
    Treatise(3, "philo.vita-mosis", "On the Life of Moses", "De vita Mosis", r"PROPHETIC OFFICE OF MOSES", 2),
    Treatise(3, "philo.vita-mosis", "On the Life of Moses", "De vita Mosis", r"PROPHETIC OFFICE OF MOSES", 3),
    Treatise(3, "philo.decalogo", "On the Decalogue", "De decalogo", r"CONCERNING THE TEN COMMANDMENTS"),
    Treatise(3, "philo.circumcisione", "On Circumcision", "De specialibus legibus 1.1–11", r"^ON CIRCUMCISION$"),
    Treatise(3, "philo.monarchia", "On Monarchy", "De specialibus legibus 1.12–65", r"^ON MONARCHY$", 1),
    Treatise(3, "philo.monarchia", "On Monarchy", "De specialibus legibus 1.66–161", r"^ON MONARCHY$", 2),
    Treatise(3, "philo.praemiis-sacerdotum", "On the Rewards of Priests", "De specialibus legibus 1.131–161", r"BELONG TO THE PRIESTS"),
    Treatise(3, "philo.victimis", "On Animals Fit for Sacrifice", "De specialibus legibus 1.162–256", r"ANIMALS FIT FOR SACRIFICE"),
    Treatise(3, "philo.sacrificantibus", "On Those Who Offer Sacrifice", "De specialibus legibus 1.257–298", r"W[HE]O OFFER SACRIFICE"),
    Treatise(3, "philo.mercede", "On the Wages of a Harlot", "De specialibus legibus 1.280–345", r"WAGES OF A HARLOT"),
    Treatise(3, "philo.specialibus-1", "On the Special Laws (the third, fourth and fifth commandments)", "De specialibus legibus 2", r"^THE SPECIAL LAWS"),
    Treatise(3, "philo.septenario", "On the Number Seven", "De specialibus legibus 2.39–222", r"ON THE NUMBER SEVEN"),
    Treatise(3, "philo.festis", "On the Ten Festivals", "De specialibus legibus 2.41–214", r"FESTIVALS ARE TEN IN NUMBER"),
    Treatise(3, "philo.cophini", "On the Festival of the Basket", "De specialibus legibus 2.215–222", r"BASKET OF FIRST"),
    Treatise(3, "philo.parentibus", "On Honouring Parents", "De specialibus legibus 2.223–262", r"HONOUR COMMANDED TO BE PAID TO PARENTS"),
    Treatise(3, "philo.specialibus-3", "On the Special Laws (the sixth and seventh commandments)", "De specialibus legibus 3", r"SIXTH AND SEVENTH"),
    Treatise(3, "philo.specialibus-4", "On the Special Laws (the eighth, ninth and tenth commandments)", "De specialibus legibus 4", r"EIGHTH NINTH AND TENTH"),
    Treatise(3, "philo.iustitia", "On Justice", "De specialibus legibus 4.136–238", r"^ON JUSTICE$"),
    Treatise(3, "philo.iudicibus", "On the Creation of Magistrates", "De specialibus legibus 4.151–188", r"CREATION OF MAGISTRATES"),
    Treatise(3, "philo.virtutibus", "On the Virtues", "De virtutibus", r"ON THREE VIRTUES"),
    Treatise(3, "philo.praemiis", "On Rewards and Punishments", "De praemiis et poenis", r"ON REWARDS AND PUNISHMENTS"),
    Treatise(3, "philo.exsecrationibus", "On Curses", "De praemiis et poenis 127–172", r"^ON CURSES$"),
    Treatise(3, "philo.nobilitate", "On Nobility", "De virtutibus 187–227", r"^ON NOBILITY"),
    Treatise(3, "philo.probus", "Every Good Man Is Free", "Quod omnis probus liber sit", r"EVERY MAN WHO IS VIRTUOUS"),
    Treatise(4, "philo.vita-contemplativa", "On the Contemplative Life", "De vita contemplativa", r"CONTEMPLATI[VY]E LIFE"),
    Treatise(4, "philo.aeternitate", "On the Eternity of the World", "De aeternitate mundi", r"INCORRUPTIBILITY OF THE WORLD"),
    Treatise(4, "philo.flaccum", "Against Flaccus", "In Flaccum", r"^AGAINST FLACCUS$", dates=(38, 41)),
    Treatise(4, "philo.legatio", "On the Embassy to Gaius", "Legatio ad Gaium", r"OFFICE OF AMBASSADORS", dates=(41, 50)),
    # boundaries only, not imported: De mundo is a later compilation (Yonge notes it repeats On the Incorruptibility
    # word for word), and the fragments of lost works are too broken in this scan to cut reliably
    Treatise(4, "", "On the World", "De mundo", r"^CONCERNING THE WORLD$"),
    Treatise(4, "", "Fragments", "", r"^THE FRAGMENTS OF THE LOST WORKS$"),
    Treatise(4, "philo.quaestiones-genesis", "Questions and Answers on Genesis", "Quaestiones in Genesin", r"^WHICH ARISE IN GENESIS$", 1, qa=True),
    Treatise(4, "philo.quaestiones-genesis", "Questions and Answers on Genesis", "Quaestiones in Genesin", r"^WHICH ARISE IN GENESIS$", 2, qa=True),
    Treatise(4, "philo.quaestiones-genesis", "Questions and Answers on Genesis", "Quaestiones in Genesin", r"^WHICH ARISE IN GENESIS$", 3, qa=True),
]
# fmt: on

#: where a volume's text ends (on the normalised line): its index, or the end mark before the publisher's catalogue
END = re.compile(r"^(END OF VOL|CATALOGUE OF$|INDEX$)")
#: the start of a treatise's heading block (the heading's own first line)
OPENER = re.compile(r"\bT[A-Z]{1,3}AT[I1]?SE\b|\bBOOK\b|\bPA[RE]T\b|QUESTION")  # (OCR: TEEATISE, TKEATISE, PAET)
#: a printed running head: the page number and the book's or treatise's name ("38 PHILO JUDÆUS.", "ON THE … 39")
#: a printer's signature at the foot of a page ("B", "VOL. II. C", "VOL. III. A A")
SIGNATURE = re.compile(r"^\s*([A-Z](\s+[A-Z])?|[TV]OL[.,]?\s+[IVXLT1H]+[.,]?\s+([A-Z](\s+[A-Z])?)?)\s*$")
SECTION = re.compile(r"^([IVXLC]{1,7}|\d{1,3})\.\s+(\S.*)$")
FOOTNOTE = re.compile(r"^\s*[*†‡§¶•]\s*\S|^\s*\|\|\s*\S")
#: a reference in Yonge's style: "Genesis ii. 4", "Gen. xlii, 36", "Deuteronomy xvi. 21"
YONGE_REF = re.compile(
    r"\b(Genesis|Gen|Exodus|Exod|Ex|Leviticus|Levit|Lev|Numbers|Numb|Num|Deuteronomy|Deut|Joshua|Josh|Judges|Judg|"
    r"Ruth|Samuel|Sam|Kings|Psalms?|Ps|Proverbs|Prov|Ecclesiastes|Eccl|Isaiah|Isa|Jeremiah|Jer|Ezekiel|Ezek|Hosea|"
    r"Hos|Zechariah|Zech)\.?\s+([xvilcXVILC]{1,8})[.,]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?"
)
OSIS = {
    "genesis": "Gen", "gen": "Gen", "exodus": "Exod", "exod": "Exod", "ex": "Exod", "leviticus": "Lev", "levit": "Lev",
    "lev": "Lev", "numbers": "Num", "numb": "Num", "num": "Num", "deuteronomy": "Deut", "deut": "Deut",
    "joshua": "Josh", "josh": "Josh", "judges": "Judg", "judg": "Judg", "ruth": "Ruth", "psalms": "Ps", "psalm": "Ps",
    "ps": "Ps", "proverbs": "Prov", "prov": "Prov", "ecclesiastes": "Eccl", "eccl": "Eccl", "isaiah": "Isa",
    "isa": "Isa", "jeremiah": "Jer", "jer": "Jer", "ezekiel": "Ezek", "ezek": "Ezek", "hosea": "Hos", "hos": "Hos",
    "zechariah": "Zech", "zech": "Zech",
}  # fmt: skip


def roman(r: str) -> int:
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
    total = 0
    r = r.upper()
    for a, b in zip(r, r[1:] + " ", strict=True):
        total += -values[a] if b != " " and values[a] < values[b] else values[a]
    return total


#: a section number as the OCR may have misread it: T or l or 1 for I, Y for V, a comma for the stop
OCR_NUMERAL = re.compile(r"^([IVXLCHTYl1]{1,8})[.,]\s+(\S.*)$")


def _misread(token: str) -> int | None:
    fixed = token.replace("H", "II").replace("T", "I").replace("l", "I").replace("1", "I").replace("Y", "V")
    if not re.fullmatch(r"[IVXLC]+", fixed) or fixed == token:
        return None
    return roman(fixed)


def number(token: str) -> int:
    return int(token) if token.isdigit() else roman(token)


def normalise(line: str) -> str:
    """A heading line as capital letters and single spaces ('O.V    THE  ACCOUNT' → 'OV THE ACCOUNT')."""
    return " ".join(re.sub(r"[^A-Z ]", "", line.upper()).split())


def is_running_head(line: str) -> bool:
    """A page's running head: short, mostly capitals, with the page number at one end ("144 PHILO JUDiEUS.",
    "ON THE CREATION OF THE WORLD. 5", "ON THOSE WHO OFFER SACRIFICE. 24 L") — the OCR's stray lowercase allowed."""
    s = line.strip()
    if not s or len(s) > 75:
        return False
    if re.search(r"PHILO\s+JU", s.upper()):  # the left-hand pages' head, however its page number came out
        return True
    # the right-hand pages' head: the treatise's name in capitals and a page number ("£60", "8-18": the OCR mangles
    # them, but a heading inside a treatise never has a digit)
    return bool(re.search(r"\d", s)) and is_heading(s) and len(re.sub(r"[^A-Za-z]", "", s)) >= 5


#: a footnote line of references, its numerals perhaps garbled ("Exodus xii. 23. t Numbers xxxl 26."): it starts with
#: a book of the Bible and has a number. Only for recognising the line; links are made only from clean references.
NOTE_LINE = re.compile(
    r"^\W{0,3}[A-Za-z]?\W{0,2}\s*(Gen\w*|G\.?\w{0,2}n?esi[as]|Ge\w{2,5}[as]|Ex\w{2,4}|Lev\w*|Num\w*|Deut\w*|"
    r"Psalms?|Isaiah|Jeremiah|Proverbs|Joshua|Judges|Hosea|Zechariah|Iliad|Odyss\w*|Hom\.?)\b[^\n]*\d"
)  # (OCR: "Genesia", "Gertesia", "Exodua", "ExoJua"; and Yonge's notes on Homer)


def is_note_line(line: str) -> bool:
    """A line of footnote references whatever its mark became ("f Genesis ii. 4. j Genesis ii. 5. § Genesis ii. 7.")."""
    s = line.strip()
    if len(s) > 110:
        return False
    if NOTE_LINE.match(s):
        return True
    if not scripture(s):
        return False
    return len(re.sub(r"[^A-Za-z]", "", YONGE_REF.sub("", s))) <= 6


def is_heading(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) > 0.75  # ("THAT li TO BAY,")


def scripture(text: str) -> list[str]:
    """OSIS references in Yonge's style found in a text ('Genesis ii. 4' → 'Gen.2.4')."""
    out = []
    for m in YONGE_REF.finditer(text):
        book = OSIS.get(m.group(1).lower())
        if not book:
            continue
        ch, v1 = roman(m.group(2)), int(m.group(3))
        v2 = int(m.group(4)) if m.group(4) and int(m.group(4)) > v1 else None
        out.append(f"{book}.{ch}.{v1}" + (f"-{book}.{ch}.{v2}" if v2 else ""))
    return out


def find_starts(lines: list[str], treatises: list[Treatise]) -> list[int]:
    """The line where each treatise's heading block begins, in order."""
    starts: list[int] = []
    at = 0

    def opened(i: int) -> bool:
        """A real heading begins a block ("A TREATISE…", "THE SECOND BOOK…") within its last few lines;
        a running head at the top of a page never does."""
        for j in range(i, max(-1, i - 14), -1):
            # (a short line the OCR garbled inside the block, "o.v t;:e" for "ON THE", does not end it)
            if lines[j].strip() and not is_heading(lines[j]) and len(lines[j].strip()) > 12:
                return False
            if lines[j].strip() and OPENER.search(normalise(lines[j])):
                return True
        return False

    for t in treatises:
        pattern = re.compile(t.heading)
        hit = None
        for i in range(at, len(lines)):
            if END.search(normalise(lines[i])):
                break
            if (
                is_heading(lines[i])
                and not is_running_head(lines[i])
                and pattern.search(normalise(lines[i]))
                and (opened(i) or t.heading.startswith("^THE FRAGMENTS"))
            ):
                hit = i
                break
        if hit is None:
            raise IngestError(
                f"Philo, vol. {t.vol}: the heading of {t.title}{f' book {t.book}' if t.book else ''} was not found"
            )
        # back up to the block's first line ("A TREATISE", "THE SECOND BOOK"…), within the heading block
        first = hit
        for j in range(hit - 1, max(at - 1, hit - 14), -1):
            if lines[j].strip() and not is_heading(lines[j]):
                break
            if lines[j].strip() and OPENER.search(normalise(lines[j])):
                first = j
        starts.append(first)
        at = hit + 1
    return starts


def paragraphs(lines: list[str]) -> list[tuple[bool, str]]:
    """A treatise's body in order, without the page furniture: (is a footnote, text) for each paragraph."""
    items: list[tuple[bool, str]] = []
    cur: list[str] = []
    in_note = False

    def close() -> None:
        nonlocal cur, in_note
        if cur:
            items.append((in_note, join(cur)))
        cur, in_note = [], False

    for raw in lines:
        line = raw.rstrip()
        if is_running_head(line) or SIGNATURE.match(line):
            close()
            continue
        if not line.strip():
            close()
            continue
        if is_note_line(line) and not in_note:
            # footnote references printed amid a paragraph's lines (their mark garbled): kept apart, and the
            # paragraph they interrupted is joined again by mend()
            close()
            items.append((True, line.strip()))
            continue
        if not cur and FOOTNOTE.match(line):
            in_note = True
        cur.append(line.strip())
    close()
    return mend(items)


def join(lines: list[str]) -> str:
    """Lines of one paragraph as running text: words the press broke at a line end are mended ('admi-' 'rable')."""
    text = ""
    for ln in lines:
        if text.endswith("-") and ln[:1].islower():
            text = text[:-1] + ln
        elif text.endswith("—"):
            text += ln
        else:
            text = f"{text} {ln}" if text else ln
    return " ".join(text.split())


def mend(items: list[tuple[bool, str]]) -> list[tuple[bool, str]]:
    """Paragraphs the page break cut in two, joined again (the first does not end a sentence, the next starts low).
    Footnotes between the two halves stay where they were, after the mended paragraph."""
    out: list[tuple[bool, str]] = []
    held: list[tuple[bool, str]] = []  # footnotes met since the last paragraph
    for note, p in items:
        if note:
            held.append((True, p))
            continue
        last = next((k for k in range(len(out) - 1, -1, -1) if not out[k][0]), None)
        if (
            last is not None
            and last == len(out) - 1
            and not re.search(r"[.?!:;\"”’)]$", out[last][1])
            and (p[:1].islower() or out[last][1].endswith(("-", ",")))
        ):
            prev = out[last][1]
            out[last] = (False, prev[:-1] + p if prev.endswith("-") and p[:1].islower() else f"{prev} {p}")
            out.extend(held)
        else:
            out.extend(held)
            out.append((False, p))
        held = []
    return out + held


def tidy(text: str) -> str:
    """Remove OCR traces the reader should not see: footnote marks, stray symbols, broken spacing before punctuation."""
    text = re.sub(r"\s*[*†‡§¶•]+(?=[\s,.;:]|$)", "", text)
    text = text.replace("^", "")  # an OCR speck ("w^ere")
    text = re.sub(r"\s+([,.;:?!])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    return " ".join(text.split())


QUESTION_END = re.compile(r"\?\W{0,4}[*†‡§¶•tJ]?\W{0,2}$")  # '… created ?"t', '… sprung up?" J'


def sections(items: list[tuple[bool, str]], book: int | None, qa: bool = False) -> list[Section]:
    """Cut a treatise into its numbered sections. A footnote's Scripture goes to the section it was printed under
    (a note sits at the foot of the page its mark is on, so at worst it belongs to the section just before). In a
    work of questions and answers, the question printed before a numbered answer opens that section."""
    out: list[tuple[int, list[str], list[str], str]] = []  # (number, paragraphs, refs from footnotes, question)
    expect = 1
    asked = ""  # a question waiting for its numbered answer
    for note, p in items:
        if note:
            if out:
                out[-1][2].extend(scripture(p))
            continue
        m = SECTION.match(p)
        slip = OCR_NUMERAL.match(p)
        # the next number, or one a little further on when the OCR lost some in between (On the Decalogue: IV, VIII)
        if m and expect <= (n := number(m.group(1))) <= expect + 5 and n <= 400:
            out.append((n, [m.group(2)], [], asked))
            expect, asked = n + 1, ""
        # a numeral the OCR misread ("XTX." for XIX, "XYI." for XVI), taken only when it reads as the very next one
        elif slip and _misread(slip.group(1)) == expect:
            out.append((expect, [slip.group(2)], [], asked))
            expect, asked = expect + 1, ""
        elif qa and QUESTION_END.search(p) and len(p) < 900:
            asked = f"{asked} {p}".strip() if asked else p
        elif out:
            out[-1][1].append(p)
        elif p.strip():
            out.append((0, [p], [], ""))  # a preface before section I
    result = []
    for n, ps, noted, question in out:
        cite = f"{book}.{n}" if book else str(n)
        body_text = [tidy(p) for p in ps if len(p) > 1]
        q = tidy(re.sub(r"\s*[tJ]$", "", question)) if question else ""
        html_body = (f'<p class="question"><b>{html.escape(q)}</b></p>' if q else "") + "".join(
            f"<p>{html.escape(p)}</p>" for p in body_text
        )
        text = " ".join([q, *body_text]).strip()
        refs = [(osis, True, "") for osis in noted] + [(osis, False, "") for osis in scripture(" ".join(ps))]
        if q:
            title = q if len(q) <= 110 else q[:107].rsplit(" ", 1)[0] + "…"
        else:
            title = f"Book {book}, {n}" if book else (f"Section {n}" if n else "Preface")
        result.append(Section(cite, title, html_body, text, refs))
    return result


@dataclass
class PhiloWork:
    id: str
    title: str
    latin: str
    dates: tuple[int, int]
    sections: list[Section]


def philo(paths: list[Path]) -> list[PhiloWork]:
    """Every treatise of the four volumes, in order, cut into sections."""
    works: dict[str, PhiloWork] = {}
    for vol, path in enumerate(paths, start=1):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        stop = next((i for i, ln in enumerate(lines) if END.search(normalise(ln))), len(lines))
        lines = lines[:stop]
        ts = [t for t in TREATISES if t.vol == vol]
        starts = find_starts(lines, ts)
        for t, a, b in zip(ts, starts, [*starts[1:], len(lines)], strict=True):
            if not t.id:
                continue  # a boundary: what follows is not imported
            body = lines[a:b]
            # skip the heading block: the body begins at the first paragraph that is not all capitals
            k = next((i for i, ln in enumerate(body) if ln.strip() and not is_heading(ln)), len(body))
            secs = sections(paragraphs(body[k:]), t.book, t.qa)
            if sum(len(s.text) for s in secs) < 1000:  # some are short (On Circumcision: two sections; Seven: a page)
                raise IngestError(f"Philo: {t.title}{f' book {t.book}' if t.book else ''} came out almost empty")
            w = works.setdefault(t.id, PhiloWork(t.id, t.title, t.latin, t.dates, []))
            w.sections.extend(secs)
    return list(works.values())
