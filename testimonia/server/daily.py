"""The verse of the day, and a verse 'for you'.

* Every day of the year has its verse: the 365 single verses the church before Nicaea (to AD 325) quoted most,
  in Bible order spread through the year, so a year of verses never repeats.
* The church year comes first: Christmas, Epiphany, the Annunciation, Holy Week, Easter, the Ascension,
  Pentecost, All Saints and the seasons of Advent and Lent have fitting verses (Easter is reckoned each year).
* 'For you' follows the reader: from the chapter they were reading, a passage the cross references and the
  fathers tie to it, a different one each day.
"""

from __future__ import annotations

import datetime as dt
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Query, Request

from .api import _osis, _verse_key, store
from .store import Store

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------- the church year


def easter(year: int) -> dt.date:
    """Western Easter (the anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return dt.date(year, month, day + 1)


def advent_start(year: int) -> dt.date:
    """The fourth Sunday before Christmas."""
    xmas = dt.date(year, 12, 25)
    return xmas - dt.timedelta(days=(xmas.weekday() + 1) % 7 or 7) - dt.timedelta(weeks=3)


#: verses for the seasons, taken in turn through each one
ADVENT = [
    "Isa.7.14",
    "Isa.9.6",
    "Isa.40.3",
    "Mic.5.2",
    "Isa.11.1",
    "Mal.3.1",
    "Isa.40.1",
    "Luke.1.31",
    "Isa.35.5",
    "Jer.23.5",
    "Isa.52.7",
    "Luke.1.46",
    "Zech.9.9",
    "Isa.60.1",
    "Luke.1.78",
    "Gen.3.15",
    "Num.24.17",
    "Isa.2.4",
    "Ps.24.7",
    "Isa.61.1",
    "Hag.2.7",
    "Luke.1.68",
    "John.1.9",
    "Rom.13.11",
    "Isa.62.11",
    "Ps.85.10",
    "Luke.3.4",
    "Isa.64.1",
]
LENT = [
    "Joel.2.12",
    "Ps.51.10",
    "Matt.4.4",
    "Isa.58.6",
    "Matt.6.6",
    "Ps.51.17",
    "Matt.16.24",
    "Isa.53.3",
    "Luke.15.20",
    "Mark.8.34",
    "Jonah.3.10",
    "Ezek.36.26",
    "Ps.130.1",
    "Isa.55.6",
    "Hos.6.1",
    "2Cor.6.2",
    "Ps.32.5",
    "Matt.6.16",
    "Luke.18.13",
    "Isa.1.18",
    "Gal.2.20",
    "Phil.2.8",
    "Heb.12.2",
    "Rom.5.8",
    "1Pet.2.24",
    "Ps.22.1",
    "Lam.1.12",
    "Isa.50.6",
    "Zech.12.10",
    "John.3.14",
    "Num.21.8",
    "John.12.24",
    "Ps.31.5",
    "Luke.23.42",
    "John.19.30",
    "Isa.53.5",
    "Isa.53.7",
    "Mark.10.45",
    "Matt.26.39",
    "Heb.4.15",
]
EASTERTIDE = [
    "Matt.28.6",
    "1Cor.15.20",
    "John.11.25",
    "Rom.6.4",
    "1Cor.15.55",
    "Luke.24.32",
    "John.20.29",
    "Rev.1.18",
    "1Pet.1.3",
    "Col.3.1",
    "John.10.11",
    "John.14.19",
    "Rom.8.11",
    "Phil.3.10",
    "Acts.2.24",
    "John.20.21",
    "Luke.24.46",
    "1Cor.15.3",
    "Eph.1.20",
    "Heb.13.20",
]

FIXED: dict[tuple[int, int], tuple[str, str]] = {
    (1, 1): ("The New Year", "Ps.90.12"),
    (1, 6): ("Epiphany", "Matt.2.11"),
    (2, 2): ("The Presentation of the Lord", "Luke.2.32"),
    (3, 25): ("The Annunciation", "Luke.1.38"),
    (6, 24): ("The Birth of John the Baptist", "Luke.1.76"),
    (6, 29): ("Saints Peter and Paul", "Matt.16.18"),
    (8, 6): ("The Transfiguration", "Matt.17.2"),
    (11, 1): ("All Saints", "Heb.12.1"),
    (11, 2): ("All Souls", "John.11.25"),
    (12, 24): ("Christmas Eve", "Isa.9.2"),
    (12, 25): ("Christmas", "John.1.14"),
    (12, 26): ("Saint Stephen, the first martyr", "Acts.7.59"),
    (12, 28): ("The Holy Innocents", "Matt.2.18"),
}


def season(day: dt.date) -> tuple[str | None, str | None]:
    """(the feast or season, its verse) for a date, or (None, None) in ordinary time."""
    if (day.month, day.day) in FIXED:
        return FIXED[(day.month, day.day)]
    e = easter(day.year)
    moveable = {
        -46: ("Ash Wednesday", "Joel.2.13"),
        -7: ("Palm Sunday", "Zech.9.9"),
        -3: ("Maundy Thursday", "John.13.34"),
        -2: ("Good Friday", "Isa.53.5"),
        -1: ("Holy Saturday", "1Pet.3.18"),
        0: ("Easter Day", "Matt.28.6"),
        39: ("The Ascension", "Acts.1.11"),
        49: ("Pentecost", "Acts.2.4"),
        56: ("Trinity Sunday", "Matt.28.19"),
    }
    off = (day - e).days
    if off in moveable:
        return moveable[off]
    if -46 < off < -7:
        return "Lent", LENT[(off + 46) % len(LENT)]
    if 0 < off < 49:
        return "Eastertide", EASTERTIDE[off % len(EASTERTIDE)]
    start = advent_start(day.year)
    if start <= day < dt.date(day.year, 12, 24):
        return "Advent", ADVENT[(day - start).days % len(ADVENT)]
    return None, None


# ---------------------------------------------------------------- the year of verses


@lru_cache(maxsize=4)
def year_of_verses(db: int, s: Store) -> list[int]:
    """The 365 verses the pre-Nicene writers quoted most, in Bible order (one for each day)."""
    del db
    rows = s.all(
        "SELECT start_vkey AS k, count(DISTINCT work_id) AS works FROM citation "
        "WHERE year IS NOT NULL AND year <= 325 AND start_vkey = end_vkey "
        "GROUP BY start_vkey ORDER BY works DESC LIMIT 365"
    )
    return sorted(r["k"] for r in rows)


def _verse_of(s: Store, day: dt.date) -> tuple[str, str | None]:
    occasion, osis = season(day)
    if osis:
        return osis, occasion
    verses = year_of_verses(id(s), s)
    if not verses:
        return "John.1.1", None
    return _osis(verses[(day.timetuple().tm_yday - 1) % len(verses)]), None


def _early(s: Store, k: int) -> dict[str, Any] | None:
    """The earliest named writer who quoted a verse, with the excerpt."""
    return s.one(
        "SELECT c.year, c.snippet, c.work_id, c.edition_id, c.section_ord, p.name AS author, w.title AS work "
        "FROM citation c JOIN person p ON p.id = c.author_id LEFT JOIN work w ON w.id = c.work_id "
        "WHERE c.start_vkey = ? AND c.year IS NOT NULL AND c.snippet IS NOT NULL ORDER BY c.year LIMIT 1",
        (k,),
    )


@router.get("/daily")
def daily(request: Request, date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict[str, Any]:
    """The verse of the day for a date ('YYYY-MM-DD', the reader's own day), with the feast or season."""
    s = store(request)
    day = dt.date.fromisoformat(date) if date else dt.date.today()
    osis, occasion = _verse_of(s, day)
    k = _verse_key(osis)
    count = s.one("SELECT count(DISTINCT work_id) AS n FROM citation WHERE start_vkey = ? AND year <= 325", (k,))
    return {
        "date": day.isoformat(),
        "osis": osis,
        "occasion": occasion,
        "early": _early(s, k),
        "pre_nicene_works": count["n"] if count else 0,
    }


@router.get("/daily/for-you")
def for_you(
    request: Request,
    book: str = Query(..., max_length=12),
    chapter: int = Query(..., ge=0, le=200),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
) -> dict[str, Any]:
    """A passage tied to the chapter being read, by the cross references and by how much the fathers quoted it."""
    s = store(request)
    day = dt.date.fromisoformat(date) if date else dt.date.today()
    lo = _verse_key(f"{book}.{chapter}.1") - 1
    rows = s.all(
        "SELECT x.dst_start AS k, x.src_start AS src, coalesce(x.votes, 0) AS votes, "
        "(SELECT count(*) FROM citation c WHERE c.start_vkey = x.dst_start AND c.year <= 325) AS cited "
        "FROM crossref x WHERE x.src_start BETWEEN ? AND ? AND x.dst_start NOT BETWEEN ? AND ? "
        "ORDER BY cited * 3 + votes DESC LIMIT 30",
        (lo, lo + 999, lo, lo + 999),
    )
    if not rows:
        return {"osis": None}
    pick = rows[(day.toordinal()) % min(len(rows), 10)]
    return {"osis": _osis(pick["k"]), "because": _osis(pick["src"]), "early": _early(s, pick["k"])}
