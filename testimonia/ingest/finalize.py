"""Final build pass: full-text indexes and denormalised helpers (runs after every ingest step)."""

from __future__ import annotations

import re

from .base import Context

_TAGS = re.compile(r"<[^>]+>")


def run(ctx: Context) -> None:
    con = ctx.con
    # plain text for commentary excerpts (search + previews)
    rows = con.execute("SELECT id, html FROM commentary_entry WHERE text IS NULL").fetchall()
    con.executemany(
        "UPDATE commentary_entry SET text = ? WHERE id = ?",
        ((" ".join(_TAGS.sub(" ", html or "").split()), i) for i, html in rows),
    )
    for table in ("fts_verse", "fts_work", "fts_comment", "fts_lexicon"):
        con.execute(f"INSERT INTO {table}({table}) VALUES ('rebuild')")
    con.execute("DELETE FROM fts_entity")
    con.execute(
        "INSERT INTO fts_entity (name, summary, entity_type, entity_id) SELECT title, summary, type, id FROM entity"
    )
    for table in ("fts_verse", "fts_work", "fts_comment", "fts_lexicon", "fts_entity"):
        con.execute(f"INSERT INTO {table}({table}) VALUES ('optimize')")
