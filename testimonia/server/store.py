"""Read-only data access for the API. One SQLite connection per worker thread (connections are cheap,
and read-only WAL-less access is safe to share across threads this way)."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

from .. import db

_local = threading.local()


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        db.open_core(path).close()  # fail fast on a missing or outdated database

    def con(self) -> sqlite3.Connection:
        con: sqlite3.Connection | None = getattr(_local, "con", None)
        if con is None or getattr(_local, "path", None) != self.path:
            con = db.connect(self.path, readonly=True)
            con.execute("PRAGMA query_only = ON")
            _local.con, _local.path = con, self.path
        return con

    def all(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> list[dict[str, Any]]:
        return [dict(r) for r in self.con().execute(sql, params)]

    def one(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> dict[str, Any] | None:
        row = self.con().execute(sql, params).fetchone()
        return dict(row) if row else None

    def scalar(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> Any:
        row = self.con().execute(sql, params).fetchone()
        return row[0] if row else None
