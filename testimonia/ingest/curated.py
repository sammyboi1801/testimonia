"""Curated reference tables from curated/*.csv: books, canon traditions, versifications, chronologies."""

from __future__ import annotations

import csv
from collections.abc import Iterator
from pathlib import Path

from ..books import BY_OSIS
from ..config import CURATED_DIR
from .base import Context, IngestError, step

SOURCE = "testimonia-curated"


def read_csv(name: str, required: tuple[str, ...]) -> Iterator[dict[str, str]]:
    path: Path = CURATED_DIR / name
    if not path.exists():
        raise IngestError(f"curated file missing: {path}")
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in required if c not in (reader.fieldnames or [])]
        if missing:
            raise IngestError(f"{name}: missing column(s) {missing}")
        for i, row in enumerate(reader, start=2):
            for c in required:
                if not (row.get(c) or "").strip():
                    raise IngestError(f"{name}:{i}: empty required field {c!r}")
            yield {k: (v or "").strip() for k, v in row.items()}


@step("curated", sources=[SOURCE])
def ingest_curated(ctx: Context) -> None:
    """Books, canon traditions & orders, versification schemes, chronology systems."""
    books = list(read_csv("books.csv", ("osis", "name", "testament")))
    unknown = [b["osis"] for b in books if b["osis"] not in BY_OSIS]
    if unknown:
        raise IngestError(f"books.csv has books not in testimonia/books.py: {unknown}")
    missing = set(BY_OSIS) - {b["osis"] for b in books}
    if missing:
        raise IngestError(f"books.csv lacks books defined in testimonia/books.py: {sorted(missing)}")
    ctx.insert(
        "book",
        [
            "osis",
            "ord",
            "name",
            "short_name",
            "testament",
            "hebrew_name",
            "greek_name",
            "latin_name",
            "chapters",
            "genre",
            "orig_language",
        ],
        (
            (
                b["osis"],
                BY_OSIS[b["osis"]].order,
                b["name"],
                b["osis"],
                b["testament"],
                b["hebrew_name"] or None,
                b["greek_name"] or None,
                b["latin_name"] or None,
                BY_OSIS[b["osis"]].chapters,
                b["genre"] or None,
                b["orig_language"] or None,
            )
            for b in books
        ),
    )
    ctx.insert(
        "canon_tradition",
        ["id", "name", "description"],
        ((r["id"], r["name"], r["description"]) for r in read_csv("canon_traditions.csv", ("id", "name"))),
    )
    ctx.insert(
        "canon_book",
        ["tradition_id", "book", "ord", "division", "status"],
        (
            (r["tradition_id"], r["book"], int(r["ord"]), r["division"] or None, r["status"] or "canonical")
            for r in read_csv("canon_books.csv", ("tradition_id", "book", "ord"))
        ),
    )
    ctx.insert(
        "versification",
        ["id", "name", "description"],
        ((r["id"], r["name"], r["description"]) for r in read_csv("versifications.csv", ("id", "name"))),
    )
    ctx.insert(
        "chronology_system",
        ["id", "name", "kind", "description", "source_id"],
        (
            (r["id"], r["name"], r["kind"] or None, r["description"], SOURCE)
            for r in read_csv("chronology_systems.csv", ("id", "name"))
        ),
    )
