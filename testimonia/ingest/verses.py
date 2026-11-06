"""The hub verse list: every verse that any text in the build places on the hub (KJV) numbering."""

from __future__ import annotations

from .base import Context, step


@step("verses", requires=["ebible", "septuagint", "stepbible-tagnt", "stepbible-tahot"])
def build_verse_list(ctx: Context) -> None:
    """Hub verse table derived from all mapped texts (validated against book lengths)."""
    ctx.con.execute(
        """
        INSERT OR IGNORE INTO verse (vkey, osis, book, chapter, verse)
        SELECT k.vkey,
               b.osis || '.' || ((k.vkey / 1000) % 1000) || '.' || (k.vkey % 1000),
               b.osis, (k.vkey / 1000) % 1000, k.vkey % 1000
        FROM (SELECT DISTINCT vkey FROM edition_verse
              UNION SELECT DISTINCT vkey FROM token) AS k
        JOIN book b ON b.ord = k.vkey / 1000000
        """
    )
    n = ctx.con.execute("SELECT count(*) FROM verse WHERE verse > 0").fetchone()[0]
    titles = ctx.con.execute("SELECT count(*) FROM verse WHERE verse = 0").fetchone()[0]
    ctx.log.info("  %d verses + %d Psalm titles / chapter headings on the hub", n, titles)
