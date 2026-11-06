"""SQLite connection helpers, schema creation and user-database migrations.

Three databases, two lifecycles:

* ``core.db`` (reference data) and ``ai.db`` (embeddings, AI cache, proposals) are **derived**:
  :func:`create_derived` writes the current schema into a fresh file, and :func:`open_derived`
  refuses a file whose ``PRAGMA user_version`` differs from the schema file — "rebuild it".
* ``user.db`` holds user data and is upgraded in place by :func:`migrate_user`, which applies
  ``schema/user_migrations/NNNN_*.sql`` files in order, each in its own transaction.
* Add-on modules contribute ``schema/modules/<name>.sql`` to core.db via :func:`install_module`.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .config import AI_DB, CORE_DB, SCHEMA_DIR, USER_DB

CORE_SCHEMA = SCHEMA_DIR / "core.sql"
AI_SCHEMA = SCHEMA_DIR / "ai.sql"
USER_MIGRATIONS = SCHEMA_DIR / "user_migrations"
MODULES_DIR = SCHEMA_DIR / "modules"
_MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")
_MODULE_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


class SchemaError(RuntimeError):
    """Raised when a database does not match the schema version this code expects."""


def connect(path: Path | str, *, readonly: bool = False) -> sqlite3.Connection:
    """Open a connection with the pragmas Testimonia relies on."""
    path = Path(path)
    if readonly:
        con = sqlite3.connect(
            f"file:{path.as_posix()}?mode=ro", uri=True, check_same_thread=False, isolation_level=None
        )
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Autocommit mode: transactions are opened explicitly (BEGIN … COMMIT) where needed, never implicitly.
        con = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA temp_store = MEMORY")
    con.execute("PRAGMA cache_size = -200000")  # ~200 MB page cache
    return con


# ---------------------------------------------------------------------------- core


def schema_version(schema_file: Path) -> int:
    """The ``PRAGMA user_version`` declared in a schema file."""
    m = re.search(r"PRAGMA\s+user_version\s*=\s*(\d+)", schema_file.read_text(encoding="utf-8"))
    if not m:
        raise SchemaError(f"{schema_file.name} does not declare PRAGMA user_version")
    return int(m.group(1))


def core_schema_version() -> int:
    return schema_version(CORE_SCHEMA)


def create_derived(path: Path | str, schema_file: Path) -> sqlite3.Connection:
    """Create a fresh derived database from ``schema_file`` (an existing file is replaced)."""
    path = Path(path)
    for suffix in ("", "-wal", "-shm"):
        Path(f"{path}{suffix}").unlink(missing_ok=True)
    con = connect(path)
    con.executescript(schema_file.read_text(encoding="utf-8"))
    return con


def open_derived(path: Path | str, schema_file: Path, *, readonly: bool = True) -> sqlite3.Connection:
    """Open a derived database, verifying it was built with the current schema version."""
    if not Path(path).exists():
        raise SchemaError(f"{Path(path).name} not found at {path} — run the build first")
    con = connect(path, readonly=readonly)
    found = con.execute("PRAGMA user_version").fetchone()[0]
    expected = schema_version(schema_file)
    if found != expected:
        con.close()
        raise SchemaError(f"{Path(path).name} has schema v{found}, code expects v{expected} — rebuild it")
    return con


def create_core(path: Path | str = CORE_DB) -> sqlite3.Connection:
    """Create a fresh core database and register the 'core' module."""
    con = create_derived(path, CORE_SCHEMA)
    con.execute(
        "INSERT INTO module (id, version, schema_version, description, installed_at) VALUES (?,?,?,?,?)",
        ("core", _package_version(), core_schema_version(), "Testimonia core schema", _now()),
    )
    con.commit()
    return con


def open_core(path: Path | str = CORE_DB) -> sqlite3.Connection:
    """Open an existing core database read-only, verifying its schema version."""
    return open_derived(path, CORE_SCHEMA)


def create_ai(path: Path | str = AI_DB) -> sqlite3.Connection:
    """Create a fresh (optional) AI database: chunks, embeddings, AI cache, proposals."""
    return create_derived(path, AI_SCHEMA)


def open_ai(path: Path | str = AI_DB, *, readonly: bool = False) -> sqlite3.Connection:
    return open_derived(path, AI_SCHEMA, readonly=readonly)


# ---------------------------------------------------------------------------- modules


def available_modules() -> list[str]:
    return sorted(p.stem for p in MODULES_DIR.glob("*.sql")) if MODULES_DIR.exists() else []


def install_module(con: sqlite3.Connection, name: str, version: str = "1") -> None:
    """Apply ``schema/modules/<name>.sql`` to a core database and record it in ``module``.

    A module file must declare ``PRAGMA user_version = N`` (its own schema version) and should
    prefix its tables with the module name. Installing the same module twice is an error.
    """
    if not _MODULE_NAME.match(name):
        raise SchemaError(f"invalid module name {name!r}")
    file = MODULES_DIR / f"{name}.sql"
    if not file.exists():
        raise SchemaError(f"module schema not found: {file}")
    if con.execute("SELECT 1 FROM module WHERE id = ?", (name,)).fetchone():
        raise SchemaError(f"module {name!r} is already installed")
    module_version = schema_version(file)
    core_version = con.execute("PRAGMA user_version").fetchone()[0]
    # Module scripts must not change the core version, so strip their PRAGMA user_version line.
    sql = re.sub(r"PRAGMA\s+user_version\s*=\s*\d+\s*;", "", file.read_text(encoding="utf-8"))
    con.executescript(sql)
    con.execute(f"PRAGMA user_version = {int(core_version)}")
    con.execute(
        "INSERT INTO module (id, version, schema_version, description, installed_at) VALUES (?,?,?,?,?)",
        (name, version, module_version, None, _now()),
    )
    con.commit()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _package_version() -> str:
    from . import __version__

    return __version__


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
            if buf.strip() and not all(ln.strip().startswith("--") or not ln.strip() for ln in buf.splitlines()):
                statements.append(buf.strip())
            buf = ""
    if buf.strip() and not all(ln.strip().startswith("--") or not ln.strip() for ln in buf.splitlines()):
        raise SchemaError("incomplete SQL statement at end of migration")
    return statements
