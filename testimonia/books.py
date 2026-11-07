"""Canonical book table (OSIS codes) and alias resolution.

Every verse in Scriptorium is keyed as "<OSIS>.<chapter>.<verse>", e.g. "John.1.18".
This matches the IDs used by BTB, STEPBible and most open datasets.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Book:
    osis: str
    name: str
    testament: str  # OT | NT | DC (deuterocanon / apocrypha)
    order: int
    chapters: int
    aliases: tuple[str, ...] = field(default=())


# (osis, name, testament, chapters, extra aliases)
_RAW: list[tuple[str, str, str, int, tuple[str, ...]]] = [
    ("Gen", "Genesis", "OT", 50, ("ge", "gn", "gen")),
    ("Exod", "Exodus", "OT", 40, ("ex", "exo", "exod")),
    ("Lev", "Leviticus", "OT", 27, ("le", "lv", "lev")),
    ("Num", "Numbers", "OT", 36, ("nu", "nm", "nb", "num")),
    ("Deut", "Deuteronomy", "OT", 34, ("de", "dt", "deut")),
    ("Josh", "Joshua", "OT", 24, ("jos", "josh", "jsh")),
    ("Judg", "Judges", "OT", 21, ("jdg", "jg", "judg", "jdgs")),
    ("Ruth", "Ruth", "OT", 4, ("ru", "rth")),
    ("1Sam", "1 Samuel", "OT", 31, ("1sa", "1sm", "1sam", "1kingdoms", "1kgdms")),
    ("2Sam", "2 Samuel", "OT", 24, ("2sa", "2sm", "2sam", "2kingdoms", "2kgdms")),
    ("1Kgs", "1 Kings", "OT", 22, ("1ki", "1kgs", "1kin", "1k", "3kingdoms", "3kgdms")),
    ("2Kgs", "2 Kings", "OT", 25, ("2ki", "2kgs", "2kin", "2k", "4kingdoms", "4kgdms")),
    ("1Chr", "1 Chronicles", "OT", 29, ("1ch", "1chr", "1chron", "1paralipomenon", "1par")),
    ("2Chr", "2 Chronicles", "OT", 36, ("2ch", "2chr", "2chron", "2paralipomenon", "2par")),
    ("Ezra", "Ezra", "OT", 10, ("ezr", "1esdrasvulg")),
    ("Neh", "Nehemiah", "OT", 13, ("ne", "neh")),
    ("Esth", "Esther", "OT", 10, ("es", "est", "esth")),
    ("Job", "Job", "OT", 42, ("jb",)),
    ("Ps", "Psalms", "OT", 150, ("ps", "psa", "pss", "psalm", "pslm", "psm")),
    ("Prov", "Proverbs", "OT", 31, ("pr", "prv", "pro", "prov")),
    ("Eccl", "Ecclesiastes", "OT", 12, ("ec", "ecc", "eccl", "eccles", "qoh", "qoheleth")),
    (
        "Song",
        "Song of Solomon",
        "OT",
        8,
        ("so", "song", "sos", "songofsongs", "canticles", "cant", "canticleofcanticles", "sg"),
    ),
    ("Isa", "Isaiah", "OT", 66, ("is", "isa", "esaias")),
    ("Jer", "Jeremiah", "OT", 52, ("je", "jer", "jr", "jeremias")),
    ("Lam", "Lamentations", "OT", 5, ("la", "lam")),
    ("Ezek", "Ezekiel", "OT", 48, ("eze", "ezek", "ezk", "ezechiel")),
    ("Dan", "Daniel", "OT", 12, ("da", "dan", "dn")),
    ("Hos", "Hosea", "OT", 14, ("ho", "hos", "osee")),
    ("Joel", "Joel", "OT", 3, ("joe", "jl")),
    ("Amos", "Amos", "OT", 9, ("am", "amo")),
    ("Obad", "Obadiah", "OT", 1, ("ob", "obad", "oba", "abdias")),
    ("Jonah", "Jonah", "OT", 4, ("jon", "jnh", "jonas")),
    ("Mic", "Micah", "OT", 7, ("mi", "mic", "mch", "micheas")),
    ("Nah", "Nahum", "OT", 3, ("na", "nah")),
    ("Hab", "Habakkuk", "OT", 3, ("hab", "hb", "habacuc")),
    ("Zeph", "Zephaniah", "OT", 3, ("zep", "zeph", "zph", "sophonias")),
    ("Hag", "Haggai", "OT", 2, ("hag", "hg", "aggeus")),
    ("Zech", "Zechariah", "OT", 14, ("zec", "zech", "zch", "zacharias")),
    ("Mal", "Malachi", "OT", 4, ("mal", "ml", "malachias")),
    ("Matt", "Matthew", "NT", 28, ("mt", "mat", "matt")),
    ("Mark", "Mark", "NT", 16, ("mk", "mr", "mar", "mrk")),
    ("Luke", "Luke", "NT", 24, ("lk", "lu", "luk")),
    ("John", "John", "NT", 21, ("jn", "jhn", "joh")),
    ("Acts", "Acts", "NT", 28, ("ac", "act", "actsoftheapostles")),
    ("Rom", "Romans", "NT", 16, ("ro", "rom", "rm")),
    ("1Cor", "1 Corinthians", "NT", 16, ("1co", "1cor")),
    ("2Cor", "2 Corinthians", "NT", 13, ("2co", "2cor")),
    ("Gal", "Galatians", "NT", 6, ("ga", "gal")),
    ("Eph", "Ephesians", "NT", 6, ("eph", "ephes")),
    ("Phil", "Philippians", "NT", 4, ("php", "phil", "pp")),
    ("Col", "Colossians", "NT", 4, ("col",)),
    ("1Thess", "1 Thessalonians", "NT", 5, ("1th", "1thess", "1thes", "1ts")),
    ("2Thess", "2 Thessalonians", "NT", 3, ("2th", "2thess", "2thes", "2ts")),
    ("1Tim", "1 Timothy", "NT", 6, ("1ti", "1tim", "1tm")),
    ("2Tim", "2 Timothy", "NT", 4, ("2ti", "2tim", "2tm")),
    ("Titus", "Titus", "NT", 3, ("tit", "ti")),
    ("Phlm", "Philemon", "NT", 1, ("phm", "phlm", "philem", "phile")),
    ("Heb", "Hebrews", "NT", 13, ("heb",)),
    ("Jas", "James", "NT", 5, ("jas", "jam", "jm")),
    ("1Pet", "1 Peter", "NT", 5, ("1pe", "1pet", "1pt", "1p")),
    ("2Pet", "2 Peter", "NT", 3, ("2pe", "2pet", "2pt", "2p")),
    ("1John", "1 John", "NT", 5, ("1jn", "1jo", "1joh", "1john", "1jhn")),
    ("2John", "2 John", "NT", 1, ("2jn", "2jo", "2joh", "2john", "2jhn")),
    ("3John", "3 John", "NT", 1, ("3jn", "3jo", "3joh", "3john", "3jhn")),
    ("Jude", "Jude", "NT", 1, ("jud", "jd")),
    (
        "Rev",
        "Revelation",
        "NT",
        22,
        ("re", "rev", "rv", "apoc", "apocalypse", "revelations", "therevelation"),
    ),
    # Deuterocanon / Apocrypha (OSIS names)
    ("Tob", "Tobit", "DC", 14, ("tob", "tb", "tobias")),
    ("Jdt", "Judith", "DC", 16, ("jdt", "jdth", "jth")),
    ("AddEsth", "Additions to Esther", "DC", 16, ("addesth", "esthgr", "greekesther", "adest", "addesther")),
    ("Wis", "Wisdom of Solomon", "DC", 19, ("wis", "ws", "wisdom", "wisd", "wisdomofsolomon")),
    ("Sir", "Sirach", "DC", 51, ("sir", "ecclus", "ecclesiasticus", "ben sira", "bensira")),
    ("Bar", "Baruch", "DC", 6, ("bar",)),
    ("EpJer", "Letter of Jeremiah", "DC", 1, ("epjer", "letjer", "epistleofjeremiah", "letterofjeremiah")),
    (
        "PrAzar",
        "Prayer of Azariah",
        "DC",
        1,
        ("prazar", "azariah", "songofthethree", "songofthreeyouths", "praz"),
    ),
    ("Sus", "Susanna", "DC", 1, ("sus",)),
    ("Bel", "Bel and the Dragon", "DC", 1, ("bel", "belandthedragon")),
    ("1Macc", "1 Maccabees", "DC", 16, ("1ma", "1mac", "1macc")),
    ("2Macc", "2 Maccabees", "DC", 15, ("2ma", "2mac", "2macc")),
    ("3Macc", "3 Maccabees", "DC", 7, ("3ma", "3mac", "3macc")),
    ("4Macc", "4 Maccabees", "DC", 18, ("4ma", "4mac", "4macc")),
    ("1Esd", "1 Esdras", "DC", 9, ("1es", "1esd", "1esdr", "3esdras")),
    ("2Esd", "2 Esdras", "DC", 16, ("2es", "2esd", "2esdr", "4esdras", "4ezra")),
    ("PrMan", "Prayer of Manasseh", "DC", 1, ("prman", "manasseh", "prayerofmanasses")),
    ("Ps151", "Psalm 151", "DC", 1, ("ps151", "psalm151")),
]

BOOKS: list[Book] = []
BY_OSIS: dict[str, Book] = {}
_ALIAS: dict[str, str] = {}

_ROMAN = {
    "iii": "3",
    "ii": "2",
    "i": "1",
    "first": "1",
    "second": "2",
    "third": "3",
    "fourth": "4",
    "iv": "4",
}


def norm_alias(s: str) -> str:
    """Normalise a book name/abbreviation for lookup: '1 Cor.' -> '1cor', 'II Kings' -> '2kings'."""
    s = s.strip().lower().replace("’", "'")
    m = re.match(r"^(iii|ii|iv|i|first|second|third|fourth)[\s.]+(.*)$", s)
    if m:
        s = _ROMAN[m.group(1)] + m.group(2)
    s = re.sub(r"^(st|saint)\.?\s+", "", s)
    s = re.sub(r"^(the )?(gospel|epistle|book|letter) (according to|of|to the|to) (st\.? )?", "", s)
    return re.sub(r"[\s.'\-]", "", s)


for i, (osis, name, test, ch, extra) in enumerate(_RAW, start=1):
    b = Book(osis, name, test, i, ch, extra)
    BOOKS.append(b)
    BY_OSIS[osis] = b
    for a in (osis, name, *extra):
        _ALIAS.setdefault(norm_alias(a), osis)

# Common singular/plural & name variants
for a, o in {
    "psalms": "Ps",
    "songofsolomon": "Song",
    "revelationofjohn": "Rev",
    "lamentationsofjeremiah": "Lam",
    "acts": "Acts",
}.items():
    _ALIAS.setdefault(a, o)


def resolve_book(name: str) -> str | None:
    """Return the OSIS code for a book name / abbreviation, or None."""
    if name in BY_OSIS:
        return name
    return _ALIAS.get(norm_alias(name))


def fuzzy_books(name: str, n: int = 4) -> list[str]:
    """Books a loosely typed name could mean, best first: 'jon' → John, Jonah; 'jhon' → John;
    'revelations' → Revelation; 'phillipians' → Philippians. Exact aliases come first."""
    import difflib

    key = norm_alias(name)
    if not key or len(key) < 2:
        return []
    out: list[str] = []
    exact = _ALIAS.get(key)
    if exact:
        out.append(exact)
    scored: dict[str, float] = {}
    for alias, osis in _ALIAS.items():
        if alias[:1].isdigit() != key[:1].isdigit():  # '1 john' never means 'john'
            continue
        r = difflib.SequenceMatcher(None, key, alias).ratio()
        if len(key) > 3 and sorted(key) == sorted(alias):  # swapped letters: 'jhon' → john
            r = max(r, 0.95)
        if alias.startswith(key):  # typed the start of a name: 'phil' → Philippians, Philemon
            r = max(r, 0.75 + 0.2 * len(key) / len(alias))
        if r > scored.get(osis, 0):
            scored[osis] = r
    for osis, r in sorted(scored.items(), key=lambda kv: (-kv[1], book_order(kv[0]))):
        if r < 0.7 or len(out) >= n:
            break
        if osis not in out:
            out.append(osis)
    return out


def book_order(osis: str) -> int:
    b = BY_OSIS.get(osis)
    return b.order if b else 999


_ROMAN_OF = {"1": "I", "2": "II", "3": "III", "4": "IV"}


def _alias_pattern(form: str) -> str:
    """'1 Corinthians' -> '(?:1|I)\\s*Corinthians'; inner spaces match any whitespace."""
    m = re.match(r"^([1-4])\s*(.+)$", form)
    if m:
        num, rest = m.groups()
        return rf"(?:{num}|{_ROMAN_OF[num]})\s*" + re.escape(rest).replace(r"\ ", r"\s+")
    return re.escape(form).replace(r"\ ", r"\s+")


def alias_regex() -> str:
    """Regex alternation (longest first) of every alias form, for scanning free text.

    Numbered books accept '1 Cor', '1Cor', 'I Cor'. Callers should require a following
    chapter number so that short aliases ('is', 'so', 'am') never match ordinary words.
    """
    forms: set[str] = set()
    for b in BOOKS:
        forms.update((b.osis, b.name, *b.aliases))
    return "|".join(_alias_pattern(f) for f in sorted(forms, key=len, reverse=True))
