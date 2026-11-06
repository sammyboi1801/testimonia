"""Framework shared by every ingest step.

An ingest *step* is a function registered with :func:`step`. It declares which manifest sources
it reads (``sources``) and which other steps must run first (``requires``). The build runs steps
in dependency order, each inside its own transaction, and records the sources it used.

Steps must be **idempotent**: they only ever insert rows tagged with their own ``source_id``,
and :meth:`Context.clear` removes those rows first.
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .. import fetch
from ..sources import Manifest, Source

StepFunc = Callable[["Context"], None]


class IngestError(RuntimeError):
    """An ingest step found input it cannot process safely."""


@dataclass(frozen=True)
class Step:
    id: str
    func: StepFunc
    sources: tuple[str, ...]
    requires: tuple[str, ...]
    optional: bool
    description: str


STEPS: dict[str, Step] = {}


def step(
    id: str,
    *,
    sources: Iterable[str] = (),
    requires: Iterable[str] = (),
    optional: bool = False,
) -> Callable[[StepFunc], StepFunc]:
    """Register an ingest step."""

    def deco(func: StepFunc) -> StepFunc:
        if id in STEPS:
            raise ValueError(f"duplicate ingest step {id!r}")
        doc = (func.__doc__ or "").strip().splitlines()
        STEPS[id] = Step(id, func, tuple(sources), tuple(requires), optional, doc[0] if doc else "")
        return func

    return deco


@dataclass
class Context:
    """Everything a step needs: the open core database, the manifest and source locations."""

    con: sqlite3.Connection
    manifest: Manifest
    public: bool = False
    log: logging.Logger = field(default_factory=lambda: logging.getLogger("testimonia.ingest"))
    #: Shared, build-scoped cache for expensive parsed inputs (e.g. TVTMS rules) used by several steps.
    cache: dict[str, Any] = field(default_factory=dict)
    _registered: set[str] = field(default_factory=set)

    # -- sources ---------------------------------------------------------------------------
    def source(self, source_id: str) -> Source:
        return self.manifest.get(source_id)

    def paths(self, source_id: str) -> list[Path]:
        """Local paths of a fetched source (raises if it was never fetched)."""
        found = [p for p in fetch.resolve_paths(self.source(source_id)) if p.exists()]
        if not found:
            raise IngestError(f"source {source_id!r} has not been fetched — run `testimonia fetch {source_id}`")
        return found

    def path(self, source_id: str, *parts: str) -> Path:
        """First local path of a source, optionally joined with sub-paths (must exist)."""
        p = self.paths(source_id)[0].joinpath(*parts)
        if not p.exists():
            raise IngestError(f"{source_id}: expected file not found: {p}")
        return p

    def find(self, source_id: str, name: str) -> Path:
        """A fetched file or folder of a source by name (a top-level path, or anything beneath one)."""
        for p in self.paths(source_id):
            if p.name == name:
                return p
        for p in self.paths(source_id):
            if p.is_dir():
                hit = next(p.rglob(name), None)
                if hit is not None:
                    return hit
        raise IngestError(f"{source_id}: {name!r} not found among fetched files")

    def register(self, source_id: str) -> str:
        """Insert the source's provenance row (idempotent) and return its id."""
        if source_id in self._registered:
            return source_id
        s = self.source(source_id)
        lock_items = fetch.load_lock().get("items", {})
        keys = {fetch.lock_key(item) for item in s.fetch}
        pins = [v for k, v in lock_items.items() if k in keys or v.get("source") == source_id]
        version = ", ".join(sorted({v.get("commit", "")[:12] or v.get("sha256", "")[:12] for v in pins})) or None
        if s.kind == "curated":
            version = _repo_commit()
        self.con.execute(
            """INSERT OR REPLACE INTO source
               (id, name, url, version, license, attribution, share_alike, fetched_at, kind, public, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                s.id,
                s.name,
                s.url or None,
                version,
                s.license,
                s.attribution,
                int(s.share_alike),
                max((v.get("fetched_at", "") for v in pins), default=None) or None,
                s.kind,
                int(s.public and not s.verify),
                s.notes or None,
            ),
        )
        self._registered.add(source_id)
        return source_id

    # -- writing ---------------------------------------------------------------------------
    def clear(self, source_id: str, *tables: str) -> None:
        """Delete this source's rows from the given tables (makes a step re-runnable)."""
        for t in tables:
            self.con.execute(f'DELETE FROM "{t}" WHERE source_id = ?', (source_id,))

    def insert(self, table: str, columns: Iterable[str], rows: Iterable[Iterable[Any]], *, mode: str = "") -> int:
        """Bulk insert; returns the number of rows written. ``mode`` may be 'OR IGNORE' / 'OR REPLACE'."""
        cols = list(columns)
        sql = f'INSERT {mode} INTO "{table}" ({", ".join(cols)}) VALUES ({", ".join("?" * len(cols))})'
        before = self.con.total_changes
        self.con.executemany(sql, (tuple(r) for r in rows))
        return self.con.total_changes - before

    def meta(self, key: str, value: str) -> None:
        self.con.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, value))


def batched(rows: Iterable[Any], size: int = 50_000) -> Iterator[list[Any]]:
    batch: list[Any] = []
    for r in rows:
        batch.append(r)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _repo_commit() -> str | None:
    """Git commit of the Testimonia repository (version of curated data)."""
    import subprocess

    from ..config import PROJECT_DIR

    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"], cwd=PROJECT_DIR, capture_output=True, text=True, check=True
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
