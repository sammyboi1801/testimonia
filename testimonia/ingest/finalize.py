"""Final build pass: full-text indexes and denormalised helpers (runs after every ingest step)."""

from __future__ import annotations

from .base import Context


def run(ctx: Context) -> None:
    con = ctx.con
    con.execute("DELETE FROM fts_verse")
    con.execute("INSERT INTO fts_verse (text, edition_id, vkey) SELECT text, edition_id, vkey FROM edition_verse")
    con.execute("DELETE FROM fts_lexicon")
    con.execute(
        """INSERT INTO fts_lexicon (lemma, translit, gloss, body, lemma_id, lexicon_id)
           SELECT l.lemma, l.translit, l.gloss, l.definition, l.id, '' FROM lemma l"""
    )
    con.execute("DELETE FROM fts_entity")
    con.execute(
        "INSERT INTO fts_entity (name, alt_names, summary, entity_type, entity_id) "
        "SELECT title, NULL, summary, type, id FROM entity"
    )
    # FTS5 merge for faster queries
    for table in ("fts_verse", "fts_lexicon", "fts_entity"):
        con.execute(f"INSERT INTO {table}({table}) VALUES ('optimize')")
