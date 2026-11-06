"""Versification: map any Bible's native verse numbers onto the hub (KJV) numbering.

Implements STEPBible's **TVTMS** (Translators Versification Traditions with Methodology for
Standardisation, CC BY). TVTMS is a rule set: each rule says "in a Bible where these *tests*
are true (e.g. ``Psa.3:9=Last`` — Psalm 3 ends at verse 9), native verse X is standard verse Y".
The tests detect which tradition (English, Hebrew, Latin, Greek, …) a Bible follows in each
section, so mixed-tradition Bibles map correctly.

Usage::

    rules = Rules.load(path_to_tvtms)
    mapping = rules.map_edition(units)      # units: native verses of one Bible
    for m in mapping: ...                   # m.unit → m.hub (OSIS book, chapter, verse) + relation

Native text is always preserved (``Mapped.native``) so nothing is lost when a rule is imperfect.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from .books import BY_OSIS

log = logging.getLogger(__name__)

# STEPBible 3-letter codes → OSIS (hub). Greek-form books (Esg, Dan with additions) resolve via _to_hub.
STEP_TO_OSIS: dict[str, str] = {
    "gen": "Gen",
    "exo": "Exod",
    "lev": "Lev",
    "num": "Num",
    "deu": "Deut",
    "jos": "Josh",
    "jdg": "Judg",
    "rut": "Ruth",
    "1sa": "1Sam",
    "2sa": "2Sam",
    "1ki": "1Kgs",
    "2ki": "2Kgs",
    "1ch": "1Chr",
    "2ch": "2Chr",
    "ezr": "Ezra",
    "neh": "Neh",
    "est": "Esth",
    "esg": "Esth",
    "job": "Job",
    "psa": "Ps",
    "pro": "Prov",
    "ecc": "Eccl",
    "sng": "Song",
    "isa": "Isa",
    "jer": "Jer",
    "lam": "Lam",
    "ezk": "Ezek",
    "dan": "Dan",
    "hos": "Hos",
    "jol": "Joel",
    "amo": "Amos",
    "oba": "Obad",
    "jon": "Jonah",
    "mic": "Mic",
    "nam": "Nah",
    "hab": "Hab",
    "zep": "Zeph",
    "hag": "Hag",
    "zec": "Zech",
    "mal": "Mal",
    "mat": "Matt",
    "mrk": "Mark",
    "luk": "Luke",
    "jhn": "John",
    "act": "Acts",
    "rom": "Rom",
    "1co": "1Cor",
    "2co": "2Cor",
    "gal": "Gal",
    "eph": "Eph",
    "php": "Phil",
    "col": "Col",
    "1th": "1Thess",
    "2th": "2Thess",
    "1ti": "1Tim",
    "2ti": "2Tim",
    "tit": "Titus",
    "phm": "Phlm",
    "heb": "Heb",
    "jas": "Jas",
    "1pe": "1Pet",
    "2pe": "2Pet",
    "1jn": "1John",
    "2jn": "2John",
    "3jn": "3John",
    "jud": "Jude",
    "rev": "Rev",
    "tob": "Tob",
    "jdt": "Jdt",
    "ade": "AddEsth",
    "wis": "Wis",
    "sir": "Sir",
    "bar": "Bar",
    "lje": "EpJer",
    "s3y": "PrAzar",
    "sus": "Sus",
    "bel": "Bel",
    "1ma": "1Macc",
    "2ma": "2Macc",
    "3ma": "3Macc",
    "4ma": "4Macc",
    "1es": "1Esd",
    "2es": "2Esd",
    "4es": "2Esd",
    "man": "PrMan",
    "ps2": "Ps151",
}

# USFM (eBible, Paratext) → STEP codes used by TVTMS. Greek Daniel (DAG) follows Dan rules.
USFM_TO_STEP: dict[str, str] = {
    "GEN": "Gen",
    "EXO": "Exo",
    "LEV": "Lev",
    "NUM": "Num",
    "DEU": "Deu",
    "JOS": "Jos",
    "JDG": "Jdg",
    "RUT": "Rut",
    "1SA": "1Sa",
    "2SA": "2Sa",
    "1KI": "1Ki",
    "2KI": "2Ki",
    "1CH": "1Ch",
    "2CH": "2Ch",
    "EZR": "Ezr",
    "NEH": "Neh",
    "EST": "Est",
    "ESG": "Est",
    "JOB": "Job",
    "PSA": "Psa",
    "PRO": "Pro",
    "ECC": "Ecc",
    "SNG": "Sng",
    "ISA": "Isa",
    "JER": "Jer",
    "LAM": "Lam",
    "EZK": "Ezk",
    "DAN": "Dan",
    "DAG": "Dan",
    "HOS": "Hos",
    "JOL": "Jol",
    "AMO": "Amo",
    "OBA": "Oba",
    "JON": "Jon",
    "MIC": "Mic",
    "NAM": "Nam",
    "HAB": "Hab",
    "ZEP": "Zep",
    "HAG": "Hag",
    "ZEC": "Zec",
    "MAL": "Mal",
    "MAT": "Mat",
    "MRK": "Mrk",
    "LUK": "Luk",
    "JHN": "Jhn",
    "ACT": "Act",
    "ROM": "Rom",
    "1CO": "1Co",
    "2CO": "2Co",
    "GAL": "Gal",
    "EPH": "Eph",
    "PHP": "Php",
    "COL": "Col",
    "1TH": "1Th",
    "2TH": "2Th",
    "1TI": "1Ti",
    "2TI": "2Ti",
    "TIT": "Tit",
    "PHM": "Phm",
    "HEB": "Heb",
    "JAS": "Jas",
    "1PE": "1Pe",
    "2PE": "2Pe",
    "1JN": "1Jn",
    "2JN": "2Jn",
    "3JN": "3Jn",
    "JUD": "Jud",
    "REV": "Rev",
    "TOB": "Tob",
    "JDT": "Jdt",
    "WIS": "Wis",
    "SIR": "Sir",
    "BAR": "Bar",
    "LJE": "Lje",
    "S3Y": "S3Y",
    "SUS": "Sus",
    "BEL": "Bel",
    "1MA": "1Ma",
    "2MA": "2Ma",
    "3MA": "3Ma",
    "4MA": "4Ma",
    "1ES": "1Es",
    "2ES": "2Es",
    "MAN": "Man",
    "PS2": "Ps2",
}

TITLE = 0  # Psalm superscriptions are hub verse 0


def norm_book(code: str) -> str:
    return code.strip().lower()


@dataclass(frozen=True)
class Unit:
    """One native verse (or subverse) of an edition."""

    book: str  # STEP code (normalised lower-case), e.g. 'psa'
    ch: str  # chapter as text: '22', or a letter for Greek Esther additions ('a'…'f')
    v: int  # verse number (0 = title / text before v1)
    sub: int = 0  # subverse index: 0 = main text, 1 = 'a', 2 = 'b', …
    through: int = 0  # for combined verses like '15-16': last verse covered (else 0)

    @property
    def native(self) -> str:
        """Readable native reference in OSIS style, e.g. 'Ps.22.1', 'Esth.1.1b', 'Sir.11.15-16'."""
        book = STEP_TO_OSIS.get(self.book, self.book)
        ch = self.ch.upper() if not self.ch.isdigit() else self.ch
        s = f"{book}.{ch}.{self.v}"
        if self.sub:
            s += chr(ord("a") + self.sub - 1)
        if self.through:
            s += f"-{self.through}"
        return s


@dataclass(frozen=True)
class HubRef:
    book: str  # OSIS
    ch: int
    v: int  # 0 = title

    @property
    def osis(self) -> str:
        return f"{self.book}.{self.ch}.{self.v}"


@dataclass
class Mapped:
    unit: Unit
    hub: HubRef
    relation: str  # '=' same verse | 'part' part of hub verse | 'split' covers several hub verses
    rule: str = ""  # action of the TVTMS rule applied ('' = identity)
    also: list[HubRef] = field(default_factory=list)  # further hub verses covered (relation 'split')


# ------------------------------------------------------------------------------------------- refs

_REF = re.compile(
    r"^\s*([1-4]?[A-Za-z][A-Za-z0-9]{1,3})\.([0-9A-Za-z]+):(Title|TextBeforeV1|\d+)(?:(?:!|\.)([a-z]|\d+))?"
)


def _sub_index(token: str | None) -> int:
    if not token:
        return 0
    if token.isdigit():
        return int(token)
    return ord(token) - ord("a") + 1


@dataclass(frozen=True)
class Ref:
    book: str
    ch: str
    v: int  # TITLE for 'Title'
    sub: int | None  # None = whole verse; 0 = base text; n = subverse
    special: str = ""  # 'TextBeforeV1'

    @property
    def key(self) -> tuple[str, str, int]:
        return (self.book, self.ch, self.v)


def parse_ref(text: str, default_book: str = "", default_ch: str = "") -> Ref | None:
    t = text.strip()
    m = _REF.match(t)
    if not m:
        # continuation forms inside lists: '6:1', '13:1!a'
        m2 = re.match(r"^\s*([0-9A-Za-z]+):(\d+)(?:(?:!|\.)([a-z]|\d+))?", t)
        if not m2 or not default_book:
            return None
        return Ref(default_book, m2.group(1).lower(), int(m2.group(2)), _sub(m2.group(3)))
    book, ch, v, sub = m.groups()
    if v == "TextBeforeV1":
        return Ref(norm_book(book), ch.lower(), TITLE, None, special="TextBeforeV1")
    vv = TITLE if v == "Title" else int(v)
    return Ref(norm_book(book), ch.lower(), vv, _sub(sub))


def _sub(token: str | None) -> int | None:
    return None if token is None else _sub_index(token)


def expand_refs(text: str) -> list[Ref]:
    """'Gen.5:32; 6:1' / 'Gen.2:25-3:1' / 'Exo.28:23-25' / 'Est.1:1!a' → list of refs (ranges expanded)."""
    out: list[Ref] = []
    book, ch = "", ""
    for part in re.split(r"\s*[;,]\s*", text.strip()):
        if not part:
            continue
        rng = part.split("-", 1)
        start = parse_ref(rng[0], book, ch) if (book or _REF.match(rng[0])) else None
        if start is None:
            # bare verse number continuing the previous chapter: '6:1,3' style lists
            if rng[0].strip().isdigit() and book:
                start = Ref(book, ch, int(rng[0]), None)
            else:
                continue
        book, ch = start.book, start.ch
        out.append(start)
        if len(rng) == 2:
            end_txt = rng[1].strip()
            m = re.match(r"^(\d+):(\d+)$", end_txt)
            if m:  # cross-chapter range: only add the end point (endpoints suffice for mapping)
                out.append(Ref(book, m.group(1), int(m.group(2)), None))
                ch = m.group(1)
            elif re.match(r"^\d+$", end_txt):
                out.extend(Ref(book, ch, v, None) for v in range(start.v + 1, int(end_txt) + 1))
    return out


def to_hub(ref: Ref) -> HubRef | None:
    """Standard (KJV) ref → hub ref, resolving Greek Esther additions and DC book names."""
    osis = STEP_TO_OSIS.get(ref.book)
    if osis is None or not ref.ch.isdigit():
        return None
    ch = int(ref.ch)
    if osis == "Esth" and (ch > 10 or (ch == 10 and ref.v >= 4)):
        osis = "AddEsth"
    if ch < 1 or ch > BY_OSIS[osis].chapters:
        return None
    return HubRef(osis, ch, ref.v)


# ------------------------------------------------------------------------------------------- tests


class Edition:
    """The structural facts TVTMS tests need about one Bible."""

    def __init__(self, units: Iterable[tuple[Unit, str]]) -> None:
        self.text: dict[tuple[str, str, int], list[tuple[int, str]]] = defaultdict(list)
        self.last: dict[tuple[str, str], int] = {}
        for u, txt in units:
            self.text[(u.book, u.ch, u.v)].append((u.sub, txt))
            for v in range(u.v + 1, (u.through or u.v) + 1):  # combined verses: later numbers "exist"
                self.text.setdefault((u.book, u.ch, v), [(0, "")])
            top = max(u.v, u.through)
            if top > self.last.get((u.book, u.ch), 0):
                self.last[(u.book, u.ch)] = top

    def exists(self, ref: Ref) -> bool:
        parts = self.text.get(ref.key)
        if not parts:
            return False
        if ref.sub is None or ref.sub == 0:
            return any(t.strip() for _, t in parts) or len(parts) > 0
        return any(s >= ref.sub for s, _ in parts)

    def words(self, ref: Ref) -> int:
        parts = self.text.get(ref.key, [])
        if ref.sub == 0:
            parts = [p for p in parts if p[0] == 0] or parts[:1]
        return sum(len(t.split()) for _, t in parts)

    def is_last(self, ref: Ref) -> bool:
        return self.exists(ref) and self.last.get((ref.book, ref.ch)) == ref.v


_CMP = re.compile(r"^(.+?)\s*([<>])\s*(.+)$")


def _side(edition: Edition, expr: str) -> int | None:
    total = 0
    for term in expr.split("+"):
        term = term.strip()
        mult = 1
        m = re.match(r"^(.*?)\*(\d+)$", term)
        if m:
            term, mult = m.group(1), int(m.group(2))
        ref = parse_ref(term)
        if ref is None:
            return None
        total += edition.words(ref) * mult
    return total


def eval_test(edition: Edition, test: str) -> bool:
    test = test.strip()
    if not test:
        return True
    if "=" in test and not _CMP.match(test.split("=")[0]):
        lhs, rhs = test.rsplit("=", 1)
        ref = parse_ref(lhs)
        if ref is None:
            raise ValueError(f"unparseable test {test!r}")
        rhs = rhs.strip()
        if ref.special == "TextBeforeV1":
            return rhs == "NotExist"  # verse-per-line sources never carry un-numbered title text
        if rhs == "Exist":
            return edition.exists(ref)
        if rhs == "NotExist":
            # TRUE when the verse is absent, unless its chapter simply ended earlier
            # (TVTMS: "and there IS text in the previous verse"). An absent chapter/book counts as absent.
            if edition.exists(ref):
                return False
            if ref.v <= 1 or (ref.sub or 0) > 0 or (ref.book, ref.ch) not in edition.last:
                return True
            return edition.exists(Ref(ref.book, ref.ch, ref.v - 1, None))
        if rhs == "Last":
            return edition.is_last(ref)
        raise ValueError(f"unknown test predicate in {test!r}")
    m = _CMP.match(test)
    if not m:
        raise ValueError(f"unparseable test {test!r}")
    a, op, b = _side(edition, m.group(1)), m.group(2), _side(edition, m.group(3))
    if a is None or b is None:
        raise ValueError(f"unparseable comparison {test!r}")
    return a < b if op == "<" else a > b


# ------------------------------------------------------------------------------------------- rules


@dataclass(frozen=True)
class Rule:
    line: int
    source_type: str
    source: tuple[Ref, ...]
    standard: tuple[Ref, ...]
    action: str
    tests: tuple[str, ...]


class Rules:
    """Parsed TVTMS expanded rules, indexed by source verse."""

    def __init__(self, rules: list[Rule]) -> None:
        self.rules = rules
        self.by_source: dict[tuple[str, str, int], list[Rule]] = defaultdict(list)
        for r in rules:
            if r.source:
                self.by_source[r.source[0].key].append(r)

    @classmethod
    def load(cls, path: Path) -> Rules:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        try:
            start = next(i for i, ln in enumerate(lines) if ln.startswith("#DataStart(Expanded)"))
            end = next(i for i, ln in enumerate(lines) if ln.startswith("#DataEnd(Expanded)"))
        except StopIteration as exc:
            raise ValueError(f"{path.name}: expanded data markers not found") from exc
        rules: list[Rule] = []
        bad = 0
        for i in range(start + 1, end):
            cols = lines[i].split("\t")
            if len(cols) < 4 or not cols[1].strip() or cols[1].startswith("SourceRef"):
                continue
            src, std = expand_refs(cols[1]), expand_refs(cols[2])
            if not src or not std:
                bad += 1
                continue
            tests = _normalise_tests(cols[8] if len(cols) > 8 else "", src[0].book)
            rules.append(Rule(i + 1, cols[0].strip(), tuple(src), tuple(std), cols[3].strip().rstrip("*"), tests))
        if bad:
            log.debug("TVTMS: %d rule lines with unparseable refs skipped", bad)
        log.debug("TVTMS: %d rules loaded", len(rules))
        return cls(rules)

    def map_edition(self, units: list[tuple[Unit, str]]) -> tuple[list[Mapped], dict[str, int]]:
        """Map every unit of one edition to hub verses. Returns (mappings, statistics)."""
        edition = Edition(units)
        cache: dict[str, bool] = {}
        stats: dict[str, int] = defaultdict(int)

        def passes(rule: Rule) -> bool:
            for t in rule.tests:
                if t not in cache:
                    try:
                        cache[t] = eval_test(edition, t)
                    except ValueError:
                        stats["unparseable_tests"] += 1
                        cache[t] = False
                if not cache[t]:
                    return False
            return True

        out: list[Mapped] = []
        for unit, txt in units:
            mapped = self._map_unit(unit, txt, passes)
            if mapped is None:
                stats["unmapped"] += 1
                continue
            stats["rule" if mapped.rule else "identity"] += 1
            out.append(mapped)
        return out, dict(stats)

    def _map_unit(self, unit: Unit, txt: str, passes: Callable[[Rule], bool]) -> Mapped | None:
        candidates = self.by_source.get((unit.book, unit.ch, unit.v), [])
        # A rule for this exact subverse wins; otherwise a whole-verse rule applies to the verse
        # and (as 'part') to any lettered subverses it carries.
        specific = [r for r in candidates if (r.source[0].sub or 0) == unit.sub and r.source[0].sub is not None]
        general = [r for r in candidates if r.source[0].sub is None or (unit.sub == 0 and r.source[0].sub == 0)]
        for rule in [*specific, *(r for r in general if r not in specific)]:
            if not passes(rule):
                continue
            if rule.action == "IfEmpty verse" and txt.strip():
                continue
            hubs = [h for h in (to_hub(r) for r in rule.standard) if h is not None]
            if not hubs:
                return None
            std0 = rule.standard[0]
            if rule.action == "Concatenation" or len(hubs) > 1:
                return Mapped(unit, hubs[0], "split", rule.action, also=hubs[1:])
            if (std0.sub or 0) > 0 or rule.action.startswith(("Merged", "Divided")) or unit.sub:
                return Mapped(unit, hubs[0], "part", rule.action)
            return Mapped(unit, hubs[0], "=", rule.action)
        # identity: no rule applies, so the native number is the standard number
        if unit.book == "dan" and unit.ch in ("13", "14"):  # Latin/Greek Daniel 13–14 = Susanna, Bel
            addition = HubRef("Sus" if unit.ch == "13" else "Bel", 1, unit.v)
            return Mapped(unit, addition, "part" if unit.sub else "=", "")
        hub = to_hub(Ref(unit.book, unit.ch, unit.v, None))
        if hub is None:
            return None
        rel = "part" if unit.sub else ("split" if unit.through else "=")
        also = [HubRef(hub.book, hub.ch, v) for v in range(unit.v + 1, unit.through + 1)] if unit.through else []
        return Mapped(unit, hub, rel, "", also=also)


def parse_vpl_verse(v: str) -> tuple[int, int, int]:
    """eBible verse attribute → (verse, subverse, through): '12' (12,0,0), '50a' (50,1,0), '15-16' (15,0,16)."""
    m = re.match(r"^(\d+)([a-z]?)(?:-(\d+))?$", v.strip())
    if not m:
        raise ValueError(f"unrecognised verse number {v!r}")
    return int(m.group(1)), _sub_index(m.group(2) or None), int(m.group(3) or 0)


def normalise_subverses(units: list[tuple[Unit, str]]) -> list[tuple[Unit, str]]:
    """eBible writes '1', '1b', '1c' when the first part is unlabelled (it is then subverse 'a'),
    but '50', '50a' when the bare number is the main text. Make both conventions consistent."""
    lettered: dict[tuple[str, str, int], set[int]] = defaultdict(set)
    for u, _ in units:
        if u.sub:
            lettered[(u.book, u.ch, u.v)].add(u.sub)
    j = _sub_index("j")
    out = []
    for u, t in units:
        subs = lettered.get((u.book, u.ch, u.v))
        sub = u.sub
        # Classical lettering skips 'j' (… h, i, k, l …); TVTMS counts it. Close the gap.
        if subs and j not in subs and any(s > j for s in subs) and sub > j:
            sub -= 1
        if subs and u.sub == 0 and 1 not in subs:
            sub = 1
        out.append((Unit(u.book, u.ch, u.v, sub, u.through) if sub != u.sub else u, t))
    return out


def _normalise_tests(raw: str, default_book: str) -> tuple[str, ...]:
    """Split a rule's tests and expand shorthand refs ('33:31=Exist' inherits the book)."""
    out: list[str] = []
    book = default_book
    for t in (p.strip() for p in raw.split("&")):
        if not t:
            continue
        m = re.match(r"^([1-4]?[A-Za-z][A-Za-z0-9]{1,3})\.", t)
        if m:
            book = m.group(1)
        elif re.match(r"^[0-9A-Za-z]+:", t):
            t = f"{book}.{t}"
        out.append(t)
    return tuple(out)


# ------------------------------------------------------------------------------------------- whole Bibles

#: Greek-form books that duplicate a Hebrew-form book in some editions, and the hub books they
#: contribute when the Hebrew form is also present (only the additions are taken from them).
GREEK_FORMS: dict[str, tuple[str, frozenset[str]]] = {
    "DAG": ("DAN", frozenset({"PrAzar", "Sus", "Bel"})),
    "ESG": ("EST", frozenset({"AddEsth"})),
}


@dataclass
class HubVerse:
    """Final text of one hub verse in one edition (after merging the native units mapped to it)."""

    hub: HubRef
    text: str
    native: list[str]
    relation: str  # '=' one native verse | 'part' several native units merged | 'split' native covers more


def map_bible(rules: Rules, verses: Iterable[tuple[str, str, str, str]]) -> tuple[list[HubVerse], dict[str, int]]:
    """Map a whole Bible given as (USFM book, chapter, verse-label, text) rows, in reading order.

    Handles editions that carry both Hebrew- and Greek-form books (DAN+DAG, EST+ESG), the LXX's
    combined Ezra–Nehemiah (EZR 11–23), subverse conventions and combined verses ('15-16').
    """
    rows = list(verses)
    books = {b for b, _, _, _ in rows}
    stats: dict[str, int] = defaultdict(int)
    streams: dict[str, list[tuple[Unit, str]]] = defaultdict(list)
    for usfm, ch, vlabel, text in rows:
        step = USFM_TO_STEP.get(usfm)
        if step is None:
            stats["skipped_unknown_book"] += 1
            continue
        if usfm == "EZR" and ch.isdigit() and int(ch) > 10:  # LXX 2 Esdras 11–23 = Nehemiah 1–13
            if "NEH" in books:
                stats["skipped_duplicate_nehemiah"] += 1
                continue
            step, ch = "Neh", str(int(ch) - 10)
        try:
            v, sub, through = parse_vpl_verse(vlabel)
        except ValueError:
            stats["skipped_bad_verse_label"] += 1
            continue
        stream = usfm if usfm in GREEK_FORMS and GREEK_FORMS[usfm][0] in books else "main"
        streams[stream].append((Unit(norm_book(step), ch.lower(), v, sub, through), text.strip()))

    # Units from different streams can share keys (Hebrew- and Greek-form Daniel are both 'dan'),
    # so text and reading order are tracked per (stream, unit).
    order: dict[tuple[str, Unit], int] = {}
    texts: dict[tuple[str, Unit], str] = {}
    mapped: list[tuple[str, Mapped]] = []
    for stream, raw_units in streams.items():
        units = normalise_subverses(raw_units)
        for u, t in units:
            order.setdefault((stream, u), len(order))
            texts[(stream, u)] = t
        result, st = rules.map_edition(units)
        for k, n in st.items():
            stats[k] += n
        if stream != "main":
            allowed = GREEK_FORMS[stream][1]
            kept = []
            for m in result:
                if m.hub.book in allowed:
                    kept.append(m)
                    continue
                # An undivided verse (e.g. Greek Esther 1:1 carrying all of Addition A) is kept under the
                # first addition verse it covers, so the additional text is not lost.
                extra = next((h for h in m.also if h.book in allowed), None)
                if extra is not None:
                    kept.append(Mapped(m.unit, extra, "split", m.rule, also=[h for h in m.also if h != extra]))
            stats["greek_form_units_dropped"] += len(result) - len(kept)
            result = kept
        mapped.extend((stream, m) for m in result)

    grouped: dict[HubRef, list[tuple[str, Mapped]]] = defaultdict(list)
    for stream, m in sorted(mapped, key=lambda sm: order.get((sm[0], sm[1].unit), 0)):
        grouped[m.hub].append((stream, m))
    out: list[HubVerse] = []
    for hub, sms in grouped.items():
        text = " ".join(t for t in (texts.get((s, m.unit), "") for s, m in sms) if t)
        if len(sms) == 1:
            relation = sms[0][1].relation
        else:
            relation = "part"
            if all(m.relation == "=" for _, m in sms):
                stats["merged_collisions"] += 1
        out.append(HubVerse(hub, text, [m.unit.native for _, m in sms], relation))
    out.sort(key=lambda h: (BY_OSIS[h.hub.book].order, h.hub.ch, h.hub.v))
    return out, dict(stats)
