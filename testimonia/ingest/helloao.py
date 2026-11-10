"""Classic commentaries (Matthew Henry, Jamieson-Fausset-Brown, Gill, Clarke, Calvin, Keil-Delitzsch) and the
Tyndale Open Study Notes, from the HelloAO Free Use Bible API.

``tools/fetch_helloao.py`` downloads them chapter by chapter into raw/helloao-commentaries. Each chapter's notes
are anchored at a verse and run until the next anchor; they become commentary entries over that verse range.
"""

from __future__ import annotations

import html
import json
from pathlib import Path

from .. import config
from ..books import BY_OSIS
from ..refs import vkey
from .base import Context, IngestError, step

SOURCE = "helloao-commentaries"

#: the commentaries, oldest first: id → (title, year, kind)
WORKS = {
    "john-calvin": ("John Calvin's Commentaries", 1555, "commentary"),
    "matthew-henry": ("Matthew Henry's Commentary", 1706, "commentary"),
    "john-gill": ("John Gill's Exposition", 1763, "commentary"),
    "adam-clarke": ("Adam Clarke's Commentary", 1831, "commentary"),
    "keil-delitzsch": ("Keil & Delitzsch, Old Testament", 1866, "commentary"),
    "jamieson-fausset-brown": ("Jamieson-Fausset-Brown", 1871, "commentary"),
    "tyndale": ("Tyndale Open Study Notes", 2017, "study-notes"),
}

USFM = {
    "GEN": "Gen",
    "EXO": "Exod",
    "LEV": "Lev",
    "NUM": "Num",
    "DEU": "Deut",
    "JOS": "Josh",
    "JDG": "Judg",
    "RUT": "Ruth",
    "1SA": "1Sam",
    "2SA": "2Sam",
    "1KI": "1Kgs",
    "2KI": "2Kgs",
    "1CH": "1Chr",
    "2CH": "2Chr",
    "EZR": "Ezra",
    "NEH": "Neh",
    "EST": "Esth",
    "JOB": "Job",
    "PSA": "Ps",
    "PRO": "Prov",
    "ECC": "Eccl",
    "SNG": "Song",
    "ISA": "Isa",
    "JER": "Jer",
    "LAM": "Lam",
    "EZK": "Ezek",
    "DAN": "Dan",
    "HOS": "Hos",
    "JOL": "Joel",
    "AMO": "Amos",
    "OBA": "Obad",
    "JON": "Jonah",
    "MIC": "Mic",
    "NAM": "Nah",
    "HAB": "Hab",
    "ZEP": "Zeph",
    "HAG": "Hag",
    "ZEC": "Zech",
    "MAL": "Mal",
    "MAT": "Matt",
    "MRK": "Mark",
    "LUK": "Luke",
    "JHN": "John",
    "ACT": "Acts",
    "ROM": "Rom",
    "1CO": "1Cor",
    "2CO": "2Cor",
    "GAL": "Gal",
    "EPH": "Eph",
    "PHP": "Phil",
    "COL": "Col",
    "1TH": "1Thess",
    "2TH": "2Thess",
    "1TI": "1Tim",
    "2TI": "2Tim",
    "TIT": "Titus",
    "PHM": "Phlm",
    "HEB": "Heb",
    "JAS": "Jas",
    "1PE": "1Pet",
    "2PE": "2Pet",
    "1JN": "1John",
    "2JN": "2John",
    "3JN": "3John",
    "JUD": "Jude",
    "REV": "Rev",
}


def _text(parts: list[object]) -> str:
    out: list[str] = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
        elif isinstance(p, dict):
            t = p.get("text") or p.get("heading") or p.get("content")
            if isinstance(t, str):
                out.append(t)
            elif isinstance(t, list):
                out.append(_text(t))
    return "\n\n".join(s.strip() for s in out if s and s.strip())


def _html(text: str) -> str:
    return "".join(f"<p>{html.escape(par)}</p>" for par in text.split("\n\n") if par.strip())


@step("helloao-commentaries", sources=[SOURCE], requires=["verses"], optional=True)
def ingest_helloao(ctx: Context) -> None:
    """The classic commentaries and the Tyndale study notes, as commentary entries over verse ranges."""
    root: Path = config.RAW_DIR / "helloao-commentaries"
    if not root.is_dir():
        raise IngestError("not downloaded — run `py tools/fetch_helloao.py`")
    ctx.register(SOURCE)
    last_verse = {
        r[0]: r[1] for r in ctx.con.execute("SELECT vkey / 1000 * 1000, max(vkey) FROM verse GROUP BY vkey / 1000")
    }
    ctx.insert(
        "commentary",
        ["id", "title", "kind", "year", "source_id"],
        [(cid, t, kind, year, SOURCE) for cid, (t, year, kind) in WORKS.items() if (root / cid).is_dir()],
        mode="OR IGNORE",
    )
    rows: list[tuple[str, int, int, str, str, str, str]] = []
    for cid, (title, _year, _kind) in WORKS.items():
        for f in sorted((root / cid).glob("*/*.json")):
            book = USFM.get(f.parent.name)
            if not book or book not in BY_OSIS:
                continue
            ch = int(f.stem)
            data = json.loads(f.read_text(encoding="utf-8"))
            items = [
                c
                for c in data.get("chapter", {}).get("content", [])
                if c.get("type") == "verse" and isinstance(c.get("number"), int)
            ]
            items.sort(key=lambda c: c["number"])
            chapter_end = last_verse.get(vkey(book, ch, 0), vkey(book, ch, 999))
            for i, item in enumerate(items):
                text = _text(item.get("content", []))
                if not text:
                    continue
                start = vkey(book, ch, item["number"])
                end = vkey(book, ch, items[i + 1]["number"]) - 1 if i + 1 < len(items) else chapter_end
                url = f"https://bible.helloao.org/api/c/{cid}/{f.parent.name}/{ch}.json"
                rows.append(
                    (cid, start, max(start, end), f"{title} on {BY_OSIS[book].name} {ch}", _html(text), text, url)
                )
    n = ctx.insert(
        "commentary_entry",
        ["commentary_id", "start_vkey", "end_vkey", "work_title", "html", "text", "source_url"],
        rows,
    )
    ctx.log.info("  %d notes from %d commentaries", n, len({r[0] for r in rows}))
