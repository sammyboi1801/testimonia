"""Integrity checks run at the end of every build (and by ``testimonia validate``).

Errors block the build from replacing core.db; warnings are reported but tolerated.
Each check is a small SQL query so failures are easy to reproduce by hand.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass


@dataclass(frozen=True)
class Problem:
    severity: str  # 'error' | 'warning'
    check: str
    detail: str

    def __str__(self) -> str:
        return f"[{self.severity}] {self.check}: {self.detail}"


def _has_rows(con: sqlite3.Connection, table: str) -> bool:
    return bool(con.execute(f'SELECT EXISTS (SELECT 1 FROM "{table}")').fetchone()[0] == 1)


# (severity, name, SQL returning offending rows; first column is shown, count is reported)
CHECKS: list[tuple[str, str, str]] = [
    (
        "error",
        "edition text on unknown verse",
        "SELECT edition_id || ' ' || vkey FROM edition_verse WHERE vkey NOT IN (SELECT vkey FROM verse)",
    ),
    (
        "error",
        "token on unknown verse",
        "SELECT edition_id || ' ' || vkey FROM token WHERE vkey NOT IN (SELECT vkey FROM verse)",
    ),
    (
        "error",
        "verse key does not match its parts",
        "SELECT v.osis FROM verse v JOIN book b ON b.osis = v.book "
        "WHERE v.vkey <> b.ord * 1000000 + v.chapter * 1000 + v.verse",
    ),
    (
        "error",
        "verse chapter beyond book length",
        "SELECT v.osis FROM verse v JOIN book b ON b.osis = v.book WHERE v.chapter > b.chapters",
    ),
    (
        "error",
        "variant reading without any witness",
        "SELECT unit_id || '.' || n FROM variant_reading vr WHERE NOT EXISTS "
        "(SELECT 1 FROM variant_witness w WHERE w.unit_id = vr.unit_id AND w.n = vr.n)",
    ),
    (
        "error",
        "edition without any text or words",
        "SELECT id FROM edition e WHERE NOT EXISTS (SELECT 1 FROM edition_verse ev WHERE ev.edition_id = e.id) "
        "AND NOT EXISTS (SELECT 1 FROM token t WHERE t.edition_id = e.id) AND kind <> 'manuscript'",
    ),
    (
        "error",
        "row from an unregistered source",
        "SELECT DISTINCT source_id FROM edition WHERE source_id NOT IN (SELECT id FROM source)",
    ),
    (
        "warning",
        "cross reference to unknown verse",
        "SELECT src_start || '->' || dst_start FROM crossref "
        "WHERE dst_start NOT IN (SELECT vkey FROM verse) OR src_start NOT IN (SELECT vkey FROM verse)",
    ),
    ("warning", "empty verse text", "SELECT edition_id || ' ' || vkey FROM edition_verse WHERE trim(text) = ''"),
]


def run(con: sqlite3.Connection) -> list[Problem]:
    problems: list[Problem] = []
    for row in con.execute("PRAGMA foreign_key_check").fetchall()[:20]:
        problems.append(Problem("error", "foreign key", f"{row[0]} rowid {row[1]} → {row[2]}"))
    for severity, name, sql in CHECKS:
        rows = con.execute(sql).fetchall()
        if rows:
            sample = ", ".join(str(r[0]) for r in rows[:5])
            problems.append(Problem(severity, name, f"{len(rows):,} row(s), e.g. {sample}"))
    if _has_rows(con, "verse"):
        n = con.execute("SELECT count(*) FROM verse WHERE verse > 0").fetchone()[0]
        if not 31_000 <= n <= 45_000:
            problems.append(Problem("error", "verse count implausible", f"{n:,} verses"))
    return problems
