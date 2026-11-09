"""Build core.db from fetched sources.

Guarantees
* **Atomic:** the database is built at ``core.db.building`` and only moved over ``core.db`` after
  every step and the validation suite succeed. A failed build never damages a working database.
* **Ordered:** steps run in dependency order (``requires``); ``--only`` pulls in dependencies.
* **Transactional:** each step runs in its own transaction; a failing step rolls back cleanly.
* **Recorded:** build metadata (version, git commit, timings, row counts) is written to ``meta``.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import subprocess
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from . import __version__, config, db, sources, validate
from .ingest import STEPS, load_all
from .ingest.base import Context, Step

log = logging.getLogger("testimonia.build")


class BuildError(RuntimeError):
    """The build could not complete; the previous core.db (if any) is untouched."""


@dataclass
class StepResult:
    id: str
    seconds: float
    rows: int
    skipped: str = ""


@dataclass
class BuildReport:
    ok: bool = False
    steps: list[StepResult] = field(default_factory=list)
    problems: list[validate.Problem] = field(default_factory=list)
    path: Path | None = None


def plan(only: list[str] | None = None) -> list[Step]:
    """Steps to run, topologically sorted; ``only`` selects steps plus their dependencies."""
    load_all()
    wanted: set[str] = set()

    def need(step_id: str, chain: tuple[str, ...] = ()) -> None:
        if step_id in chain:
            raise BuildError(f"dependency cycle: {' -> '.join((*chain, step_id))}")
        if step_id not in STEPS:
            raise BuildError(f"unknown ingest step {step_id!r} (known: {', '.join(sorted(STEPS))})")
        if step_id in wanted:
            return
        for dep in STEPS[step_id].requires:
            need(dep, (*chain, step_id))
        wanted.add(step_id)

    for sid in only or list(STEPS):
        need(sid)
    ordered: list[Step] = []
    done: set[str] = set()
    pending = [STEPS[s] for s in STEPS if s in wanted]  # registration order breaks ties
    while pending:
        ready = [s for s in pending if all(d in done for d in s.requires)]
        if not ready:
            raise BuildError("unresolvable step dependencies")
        for s in ready:
            ordered.append(s)
            done.add(s.id)
            pending.remove(s)
    return ordered


def _git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=config.PROJECT_DIR,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _total_rows(con: sqlite3.Connection) -> int:
    return int(con.execute("SELECT total_changes()").fetchone()[0])


def build(
    *,
    only: list[str] | None = None,
    public: bool = False,
    keep_going: bool = False,
    target: Path | None = None,
) -> BuildReport:
    # a public build goes to its own file: it must never replace the full (private) database
    target = target or (config.CORE_DB.with_name("core-public.db") if public else config.CORE_DB)
    config.ensure_dirs()
    manifest = sources.load()
    steps = plan(only)
    tmp = target.with_name(target.name + ".building")
    report = BuildReport(path=target)
    log.info("building %s (%d steps%s)", target, len(steps), ", public" if public else "")
    t_build = time.monotonic()
    con = db.create_derived(tmp, db.CORE_SCHEMA)
    try:
        con.execute(
            "INSERT INTO module (id, version, schema_version, description, installed_at) VALUES (?,?,?,?,?)",
            ("core", __version__, db.core_schema_version(), "Testimonia core schema", _now()),
        )
        ctx = Context(con=con, manifest=manifest, public=public)
        for st in steps:
            blocked = [s for s in st.sources if public and not _public_ok(manifest.get(s))]
            if blocked and len(blocked) == len(st.sources):
                log.info("· %-28s skipped (not cleared for public builds: %s)", st.id, ", ".join(blocked))
                report.steps.append(StepResult(st.id, 0.0, 0, skipped="public"))
                continue
            t0, before = time.monotonic(), _total_rows(con)
            log.info("· %-28s %s", st.id, st.description)
            try:
                with db.bulk_load(con):
                    for sid in st.sources:
                        ctx.register(sid)
                    st.func(ctx)
            except Exception as exc:
                if st.optional and keep_going:
                    log.warning("  ✗ optional step %s failed: %s", st.id, exc)
                    report.steps.append(StepResult(st.id, time.monotonic() - t0, 0, skipped=f"failed: {exc}"))
                    continue
                raise BuildError(f"step {st.id!r} failed: {exc}") from exc
            res = StepResult(st.id, time.monotonic() - t0, _total_rows(con) - before)
            report.steps.append(res)
            log.info("  ✓ %s rows in %.1fs", f"{res.rows:,}", res.seconds)

        if public:
            with db.bulk_load(con):
                removed = purge_non_public(con)
            log.info("· public build: removed %s rows from sources not cleared for redistribution", f"{removed:,}")

        log.info("· indexing & validating")
        from .ingest import finalize

        with db.bulk_load(con):
            finalize.run(ctx)
        report.problems = validate.run(con)
        errors = [p for p in report.problems if p.severity == "error"]
        for p in report.problems:
            (log.error if p.severity == "error" else log.warning)("  %s", p)
        if errors:
            raise BuildError(f"validation failed with {len(errors)} error(s); core.db not replaced")

        meta = {
            "build.version": __version__,
            "build.git_commit": _git_commit(),
            "build.finished_at": _now(),
            "build.seconds": f"{time.monotonic() - t_build:.0f}",
            "build.public": str(int(public)),
            "build.steps": ",".join(r.id for r in report.steps if not r.skipped),
        }
        con.executemany("INSERT OR REPLACE INTO meta VALUES (?, ?)", meta.items())
        con.commit()
        con.execute("ANALYZE")
        con.execute("PRAGMA optimize")
        con.execute("PRAGMA journal_mode = DELETE")  # single self-contained file
        con.close()
        _replace(tmp, target)
        report.ok = True
        log.info("built %s in %.0fs", target, time.monotonic() - t_build)
        return report
    except BaseException:
        con.close()
        log.error("build failed — %s left in place for inspection; %s unchanged", tmp.name, target.name)
        raise


def _public_ok(src: sources.Source) -> bool:
    return src.public and not src.verify


#: Tables whose rows belong to a parent row's source rather than carrying source_id themselves:
#: (child table, child column, parent table, parent key)
_DEPENDENTS: tuple[tuple[str, str, str, str], ...] = (
    ("edition_verse", "edition_id", "edition", "id"),
    ("edition_note", "edition_id", "edition", "id"),
    ("token", "edition_id", "edition", "id"),
    ("work_section", "edition_id", "work_edition", "id"),
    ("commentary_entry", "commentary_id", "commentary", "id"),
    ("variant_reading", "unit_id", "variant_unit", "id"),
    ("variant_witness", "unit_id", "variant_unit", "id"),
    ("topic_ref", "topic_id", "topic", "id"),
    ("parallel_member", "group_id", "parallel_group", "id"),
    ("canon_list_item", "list_id", "canon_list", "id"),
    ("lexicon_entry", "lexicon_id", "lexicon", "id"),
)


def purge_non_public(con: sqlite3.Connection) -> int:
    """Delete every row that comes from a source not cleared for redistribution (source.public = 0)."""
    before = int(con.execute("SELECT total_changes()").fetchone()[0])
    hidden = "(SELECT id FROM source WHERE public = 0)"
    for child, col, parent, key in _DEPENDENTS:
        con.execute(f"DELETE FROM {child} WHERE {col} IN (SELECT {key} FROM {parent} WHERE source_id IN {hidden})")
    tables = [
        r[0]
        for r in con.execute(
            "SELECT m.name FROM sqlite_master m WHERE m.type = 'table' AND m.name NOT LIKE 'fts_%' "
            "AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'source_id') AND m.name <> 'source'"
        )
    ]
    for table in tables:
        con.execute(f'DELETE FROM "{table}" WHERE source_id IN {hidden}')
    return int(con.execute("SELECT total_changes()").fetchone()[0]) - before


def _replace(tmp: Path, target: Path) -> None:
    for suffix in ("-wal", "-shm"):
        Path(f"{tmp}{suffix}").unlink(missing_ok=True)
    try:
        os.replace(tmp, target)
    except PermissionError as exc:  # Windows: target open in another process (e.g. the app)
        raise BuildError(f"cannot replace {target} — close any program using it and retry") from exc


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
