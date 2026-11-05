"""The core schema must load, be fully STRICT, and reject malformed rows."""

from __future__ import annotations

import sqlite3

import pytest

from testimonia import db


@pytest.fixture
def core(tmp_path):
    con = db.create_core(tmp_path / "core.db")
    con.execute("INSERT INTO source (id, name, license) VALUES ('t', 'test', 'CC0-1.0')")
    con.execute("INSERT INTO book (osis, ord, name, testament) VALUES ('John', 43, 'John', 'NT')")
    con.execute("INSERT INTO chronology_system (id, name) VALUES ('scholarly', 'Scholarly consensus')")
    yield con
    con.close()


def test_schema_version_declared():
    assert db.core_schema_version() >= 1


def test_all_tables_strict(core):
    loose = core.execute(
        "SELECT name FROM pragma_table_list WHERE type='table' AND strict=0 "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%'"
    ).fetchall()
    assert loose == []


def test_open_core_checks_version(tmp_path):
    path = tmp_path / "core.db"
    db.create_core(path).close()
    db.open_core(path).close()  # same version → ok
    con = sqlite3.connect(path)
    con.execute("PRAGMA user_version = 999")
    con.commit()
    con.close()
    with pytest.raises(db.SchemaError):
        db.open_core(path)


def test_views_compile(core):
    assert core.execute("SELECT count(*) FROM timeline").fetchone()[0] == 0
    assert core.execute("SELECT count(*) FROM verse_witness").fetchone()[0] == 0


@pytest.mark.parametrize(
    "sql",
    [
        # dating: end before start
        "INSERT INTO dating (entity_type, entity_id, system_id, date_kind, start_year, end_year) "
        "VALUES ('event','x','scholarly','span', 100, 50)",
        # dating: unknown kind
        "INSERT INTO dating (entity_type, entity_id, system_id, date_kind, start_year, end_year) "
        "VALUES ('event','x','scholarly','sometime', 100, 100)",
        # dating: a point with two different years
        "INSERT INTO dating (entity_type, entity_id, system_id, date_kind, start_year, end_year) "
        "VALUES ('event','x','scholarly','point', 100, 120)",
        # dating: no year at all
        "INSERT INTO dating (entity_type, entity_id, system_id, date_kind) VALUES ('event','x','scholarly','point')",
        # STRICT: text in an integer column
        "INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (43001018, 'John.1.18', 'John', 'one', 18)",
        # bad testament
        "INSERT INTO book (osis, ord, name, testament) VALUES ('Foo', 500, 'Foo', 'XX')",
        # manuscript date window reversed
        "INSERT INTO manuscript (id, source_id, date_from, date_to) VALUES ('GA:P0', 't', 300, 200)",
        # manuscript edition without manuscript_id
        "INSERT INTO edition (id, title, language, kind, source_id) VALUES ('m', 'm', 'grc', 'manuscript', 't')",
        # variant unit with inverted range
        "INSERT INTO variant_unit (start_vkey, end_vkey, testament, source_id) VALUES (43001019, 43001018, 'NT', 't')",
        # canon list item with unknown status
        "INSERT INTO canon_list (id, name) VALUES ('mur', 'Muratorian');"
        "INSERT INTO canon_list_item (list_id, item_type, item_id, status) VALUES ('mur','book','John','liked')",
        # empty licence
        "INSERT INTO source (id, name, license) VALUES ('bad', 'bad', '')",
    ],
)
def test_constraints_reject_bad_rows(core, sql):
    with pytest.raises(sqlite3.IntegrityError):
        core.executescript(sql)


def test_valid_rows_accepted(core):
    core.executescript(
        """
        INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (43001018, 'John.1.18', 'John', 1, 18);
        INSERT INTO dating (entity_type, entity_id, system_id, date_kind, start_year, end_year, label)
          VALUES ('manuscript', 'GA:P66', 'scholarly', 'window', 175, 225, 'c. 200');
        INSERT INTO dating (entity_type, entity_id, system_id, date_kind, start_year, end_year)
          VALUES ('event', 'fall-of-jerusalem', 'scholarly', 'point', -586, -586);
        INSERT INTO manuscript (id, source_id, date_from, date_to) VALUES ('GA:P66', 't', 175, 225);
        INSERT INTO manuscript_coverage (manuscript_id, start_vkey, end_vkey) VALUES ('GA:P66', 43001001, 43014026);
        """
    )
    rows = core.execute(
        "SELECT w.id FROM verse_witness w JOIN manuscript m ON m.id = w.id "
        "WHERE w.start_vkey <= 43001018 AND w.end_vkey >= 43001018"
    ).fetchall()
    assert [r[0] for r in rows] == ["GA:P66"]
    assert db.foreign_key_violations(core) == []
