"""user.db migrations: ordered, idempotent, and refuse to downgrade."""

from __future__ import annotations

import sqlite3

import pytest

from testimonia import db


def test_migrations_numbered_contiguously():
    numbers = [n for n, _ in db.user_migrations()]
    assert numbers == list(range(1, len(numbers) + 1))


def test_migrate_fresh_and_idempotent(tmp_path):
    path = tmp_path / "user.db"
    con = db.migrate_user(path)
    latest = db.user_migrations()[-1][0]
    assert con.execute("PRAGMA user_version").fetchone()[0] == latest
    con.execute(
        "INSERT INTO my_translation (id, vkey, text, created_at, updated_at) "
        "VALUES ('t1', 43001018, 'No one has ever seen God…', 'now', 'now')"
    )
    con.commit()
    con.close()
    con = db.migrate_user(path)  # second run applies nothing and keeps data
    assert con.execute("SELECT count(*) FROM my_translation").fetchone()[0] == 1
    con.close()


def test_refuses_newer_database(tmp_path):
    path = tmp_path / "user.db"
    con = sqlite3.connect(path)
    con.execute("PRAGMA user_version = 9999")
    con.close()
    with pytest.raises(db.SchemaError):
        db.migrate_user(path)


def test_user_tables_strict(tmp_path):
    con = db.migrate_user(tmp_path / "user.db")
    loose = con.execute(
        "SELECT name FROM pragma_table_list WHERE type='table' AND strict=0 "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'"
    ).fetchall()
    assert loose == []
