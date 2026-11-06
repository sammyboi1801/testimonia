"""Church-father commentary by verse from the HistoricalChristianFaith Commentaries-Database.

Licence: public-domain dedication for the compilation and for excerpts from public-domain sources;
the repository also contains fair-use excerpts of modern copyrighted authors. We therefore import
only authors up to MAX_YEAR (see sources.yaml) and skip the "Canonical Scriptures" folders (NT books
quoting the OT, which the quotation table already covers).
"""

from __future__ import annotations

import html
import re
import tomllib
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..books import resolve_book
from ..refs import vkey
from .base import Context, IngestError, batched, step

SOURCE = "hcf-commentaries"  # patristic authors up to PUBLIC_UNTIL (public)
LATER = "hcf-commentaries-later"  # later and undated authors (local builds only)
PUBLIC_UNTIL = 451
#: Authors after this year are excluded (their excerpts may be copyrighted; see LICENSE "FAIR USE NOTICE").
MAX_YEAR = 1900
SKIP_CATEGORIES = {"Canonical Scriptures"}
DOCUMENT_CATEGORIES = {"Apocrypha, Pseudepigrapha & Early Documents"}
_FILE = re.compile(r"^(?P<book>.+?) (?P<c>\d+)_(?P<v>\d+)(?:-(?:(?P<c2>\d+)_)?(?P<v2>\d+))?\.toml$")


def slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def era_for(year: int | None) -> str | None:
    if year is None:
        return None
    for limit, era in (
        (150, "apostolic"),
        (325, "ante-nicene"),
        (451, "nicene"),
        (750, "late-patristic"),
        (1500, "medieval"),
        (1700, "reformation"),
    ):
        if year <= limit:
            return era
    return "modern"


@dataclass(frozen=True)
class VerseFile:
    book: str
    start: int
    end: int


def parse_filename(name: str) -> VerseFile | None:
    """'John 1_18.toml' → John 1:18; 'Isaiah 28_11-12.toml' → Isa 28:11–12; 'Gen 1_1-2_3.toml' → Gen 1:1–2:3."""
    m = _FILE.match(name)
    if not m:
        return None
    book = resolve_book(m.group("book"))
    if book is None:
        return None
    c, v = int(m.group("c")), int(m.group("v"))
    c2 = int(m.group("c2")) if m.group("c2") else c
    v2 = int(m.group("v2")) if m.group("v2") else v
    try:
        start, end = vkey(book, c, v), vkey(book, c2, v2)
    except KeyError:
        return None
    return VerseFile(book, start, end) if start <= end else None


def quote_html(text: str) -> str:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    return "".join(f"<p>{html.escape(' '.join(p.split()))}</p>" for p in paras)


def _load(path: Path) -> dict[str, Any] | None:
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError):
        return None


@step("hcf-commentaries", sources=[SOURCE, LATER], requires=["verses"])
def ingest_hcf(ctx: Context) -> None:
    """Church-father comments keyed to verses (fathers → Aquinas → reformers; dated authors)."""
    root = ctx.paths(SOURCE)[0]
    metas = sorted(root.glob("*/metadata.toml"))
    if len(metas) < 100:
        raise IngestError(f"only {len(metas)} author folders under {root} — incomplete checkout?")
    known = {r[0] for r in ctx.con.execute("SELECT vkey FROM verse")}
    people, commentaries, entries = [], [], []
    datings = []
    skipped = {"category": 0, "modern": 0, "bad_file": 0, "unknown_verse": 0}
    with ThreadPoolExecutor(max_workers=16) as pool:
        for meta_path in metas:
            meta = _load(meta_path) or {}
            category = str(meta.get("father_category") or "")
            year = meta.get("default_year") if isinstance(meta.get("default_year"), int) else None
            if year is not None and year >= 9999:  # placeholder for "unknown" (pseudonymous works)
                year = None
            if category in SKIP_CATEGORIES:
                skipped["category"] += 1
                continue
            if year is not None and year > MAX_YEAR:
                skipped["modern"] += 1
                continue
            src = SOURCE if year is not None and year <= PUBLIC_UNTIL else LATER
            name = meta_path.parent.name
            is_document = category in DOCUMENT_CATEGORIES
            author_id = None if is_document else slug(name)
            cid = f"hcf:{slug(name)}"
            if author_id:
                kind = "father" if year is None or year <= 1500 else "author"
                people.append((author_id, name, kind, era_for(year), year, year, meta.get("wiki") or None, src))
                if year is not None:
                    datings.append(("person", author_id, "floruit", "hcf", "point", year, year, 1, src))
            commentaries.append((cid, name, author_id, "patristic-excerpts", year, era_for(year), src))
            files = [p for p in meta_path.parent.glob("*.toml") if p.name != "metadata.toml"]
            for path, data in zip(files, pool.map(_load, files), strict=True):
                vf = parse_filename(path.name)
                if vf is None or data is None:
                    skipped["bad_file"] += 1
                    continue
                if vf.start not in known:
                    skipped["unknown_verse"] += 1
                    continue
                for c in data.get("commentary", []):
                    quote = str(c.get("quote") or "").strip()
                    if not quote:
                        continue
                    title = str(c.get("source_title") or "").strip()
                    extra = str(c.get("append_to_author_name") or "").strip()
                    entries.append(
                        (
                            cid,
                            vf.start,
                            vf.end,
                            " ".join(filter(None, (title, extra))) or None,
                            quote_html(quote),
                            c.get("source_url") or None,
                        )
                    )
    ctx.insert(
        "person",
        ["id", "name", "kind", "era", "floruit_from", "floruit_to", "bio", "source_id"],
        (
            (p[0], p[1], p[2], p[3], p[4], p[5], f'<a href="{p[6]}">Wikipedia</a>' if p[6] else None, p[7])
            for p in people
        ),
        mode="OR IGNORE",
    )
    ctx.insert(
        "dating",
        [
            "entity_type",
            "entity_id",
            "aspect",
            "system_id",
            "date_kind",
            "start_year",
            "end_year",
            "circa",
            "source_id",
        ],
        datings,
    )
    ctx.insert("commentary", ["id", "title", "author_id", "kind", "year", "era", "source_id"], commentaries)
    for batch in batched(entries):
        ctx.insert(
            "commentary_entry", ["commentary_id", "start_vkey", "end_vkey", "work_title", "html", "source_url"], batch
        )
    pre_nicene = sum(1 for c in commentaries if (c[4] or 9999) <= 325)
    ctx.log.info(
        "  %d commentators (%d pre-Nicene), %d excerpts; skipped: %s",
        len(commentaries),
        pre_nicene,
        len(entries),
        ", ".join(f"{k} {v}" for k, v in skipped.items() if v),
    )
