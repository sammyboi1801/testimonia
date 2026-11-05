"""SQLite connection helpers, core-schema creation and user-database migrations.

* ``core.db`` is a build artifact: :func:`create_core` writes the current schema into a fresh file.
  Its version is ``PRAGMA user_version`` from ``schema/core.sql``; a mismatch means "rebuild".
* ``user.db`` holds user data and is upgraded in place by :func:`migrate_user`, which applies
  ``schema/user_migrations/NNNN_*.sql`` files in order, each in its own transaction.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .config import CORE_DB, SCHEMA_DIR, USER_DB

CORE_SCHEMA = SCHEMA_DIR / "core.sql"
USER_MIGRATIONS = SCHEMA_DIR / "user_migrations"
_MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


class SchemaError(RuntimeError):
    """Raised when a database does not match the schema version this code expects."""


def connect(path: Path | str, *, readonly: bool = False) -> sqlite3.Connection:
    """Open a connection with the pragmas Testimonia relies on."""
    path = Path(path)
    if readonly:
        con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, check_same_thread=False)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA temp_store = MEMORY")
    con.execute("PRAGMA cache_size = -200000")  # ~200 MB page cache
    return con


# ---------------------------------------------------------------------------- core


def core_schema_version() -> int:
    m = re.search(r"PRAGMA\s+user_version\s*=\s*(\d+)", CORE_SCHEMA.read_text(encoding="utf-8"))
    if not m:
        raise SchemaError("schema/core.sql does not declare PRAGMA user_version")
    return int(m.group(1))


def create_core(path: Path | str = CORE_DB) -> sqlite3.Connection:
    """Create a fresh core database (any existing file at ``path`` is replaced)."""
    path = Path(path)
    for suffix in ("", "-wal", "-shm"):
        Path(f"{path}{suffix}").unlink(missing_ok=True)
    con = connect(path)
    con.executescript(CORE_SCHEMA.read_text(encoding="utf-8"))
    return con


def open_core(path: Path | str = CORE_DB) -> sqlite3.Connection:
    """Open an existing core database read-only, verifying its schema version."""
    if not Path(path).exists():
        raise SchemaError(f"core database not found at {path} — run the build first")
    con = connect(path, readonly=True)
    found = con.execute("PRAGMA user_version").fetchone()[0]
    expected = core_schema_version()
    if found != expected:
        con.close()
        raise SchemaError(f"core.db schema v{found}, code expects v{expected} — rebuild core.db")
    return con


@contextmanager
def bulk_load(con: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Fast bulk-insert mode for the rebuildable core.db.

    Foreign keys are checked once at the end (``PRAGMA foreign_key_check``) instead of per row.
    """
    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("PRAGMA synchronous = OFF")
    try:
        con.execute("BEGIN")
        yield con
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    finally:
        con.execute("PRAGMA synchronous = NORMAL")
        con.execute("PRAGMA foreign_keys = ON")


def foreign_key_violations(con: sqlite3.Connection) -> list[tuple[object, ...]]:
    return [tuple(r) for r in con.execute("PRAGMA foreign_key_check")]


# ---------------------------------------------------------------------------- user


def user_migrations() -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    for p in sorted(USER_MIGRATIONS.glob("*.sql")):
        m = _MIGRATION_NAME.match(p.name)
        if not m:
            raise SchemaError(f"bad migration file name: {p.name} (expected NNNN_name.sql)")
        found.append((int(m.group(1)), p))
    numbers = [n for n, _ in found]
    if numbers != list(range(1, len(numbers) + 1)):
        raise SchemaError(f"user migrations must be numbered 0001.. without gaps, got {numbers}")
    return found


def migrate_user(path: Path | str = USER_DB) -> sqlite3.Connection:
    """Open (creating if needed) the user database and apply pending migrations."""
    con = connect(path)
    con.execute("PRAGMA journal_mode = WAL")
    current = con.execute("PRAGMA user_version").fetchone()[0]
    migrations = user_migrations()
    latest = migrations[-1][0] if migrations else 0
    if current > latest:
        con.close()
        raise SchemaError(f"user.db is v{current}, newer than this app (v{latest}) — upgrade Testimonia")
    for number, file in migrations:
        if number <= current:
            continue
        sql = file.read_text(encoding="utf-8")
        try:
            con.execute("BEGIN")
            for statement in _split_sql(sql):
                con.execute(statement)
            con.execute(f"PRAGMA user_version = {number}")
            con.execute("COMMIT")
        except BaseException:
            con.execute("ROLLBACK")
            raise
    return con


def _split_sql(script: str) -> list[str]:
    """Split a migration into statements (sqlite3.complete_statement aware, comment-safe)."""
    statements, buf = [], ""
    for line in script.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip() and not all(
                ln.strip().startswith("--") or not ln.strip() for ln in buf.splitlines()
            ):
                statements.append(buf.strip())
            buf = ""
    if buf.strip() and not all(ln.strip().startswith("--") or not ln.strip() for ln in buf.splitlines()):
        raise SchemaError("incomplete SQL statement at end of migration")
    return statements
