"""Generic extension points: entity_attr, entity_link, machine provenance, modules, ai.db."""

from __future__ import annotations

import sqlite3

import pytest

from testimonia import db


@pytest.fixture
def core(tmp_path):
    con = db.create_core(tmp_path / "core.db")
    con.executescript(
        """
        INSERT INTO source (id, name, license) VALUES ('t', 'test', 'CC0-1.0');
        INSERT INTO source (id, name, license, kind, method, model, public)
          VALUES ('ai-allusions', 'AI allusion tagger', 'CC0-1.0', 'machine', 'llm-allusion-tagger', 'model-x', 0);
        """
    )
    yield con
    con.close()


def test_core_module_registered(core):
    row = core.execute("SELECT id, schema_version FROM module").fetchone()
    assert row[0] == "core"
    assert row[1] == db.core_schema_version()


def test_entity_attr_requires_json(core):
    core.execute(
        "INSERT INTO entity_attr (uri, key, value, source_id) VALUES ('ms:GA:P66', 'ms.leaves', '75', 't')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        core.execute(
            "INSERT INTO entity_attr (uri, key, value, source_id) VALUES ('ms:GA:P66', 'x', 'not json', 't')"
        )


def test_entity_link_machine_proposal(core):
    core.execute(
        "INSERT INTO entity_link (src, rel, dst, confidence, review, source_id) "
        "VALUES ('section:barnabas@lightfoot#5.2', 'alludes_to', 'verse:Isa.53.5', 0.72, 'unreviewed', 'ai-allusions')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        core.execute(
            "INSERT INTO entity_link (src, rel, dst, confidence, source_id) VALUES ('a:b', 'r', 'c:d', 1.5, 't')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        core.execute(
            "INSERT INTO entity_link (src, rel, dst, review, source_id) VALUES ('a:b', 'r', 'c:d', 'maybe', 't')"
        )


def test_source_kind_checked(core):
    with pytest.raises(sqlite3.IntegrityError):
        core.execute("INSERT INTO source (id, name, license, kind) VALUES ('x', 'x', 'PD', 'vibes')")


def test_citation_review_default(core):
    core.execute(
        "INSERT INTO work (id, title, category) VALUES ('barnabas', 'Epistle of Barnabas', 'apostolic-father')"
    )
    core.execute(
        "INSERT INTO citation (start_vkey, end_vkey, work_id, source_id) VALUES (23053005, 23053005, 'barnabas', 't')"
    )
    assert core.execute("SELECT review FROM citation").fetchone()[0] == "accepted"


def test_install_module(core, tmp_path, monkeypatch):
    mods = tmp_path / "modules"
    mods.mkdir()
    (mods / "audio.sql").write_text(
        "PRAGMA user_version = 3;\n"
        "CREATE TABLE audio_track (id TEXT PRIMARY KEY, vkey INTEGER NOT NULL,"
        " source_id TEXT NOT NULL REFERENCES source(id)) STRICT;\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(db, "MODULES_DIR", mods)
    assert db.available_modules() == ["audio"]
    db.install_module(core, "audio")
    assert core.execute("PRAGMA user_version").fetchone()[0] == db.core_schema_version()
    assert core.execute("SELECT schema_version FROM module WHERE id='audio'").fetchone()[0] == 3
    core.execute("INSERT INTO audio_track VALUES ('a1', 43001018, 't')")
    with pytest.raises(db.SchemaError):
        db.install_module(core, "audio")
    with pytest.raises(db.SchemaError):
        db.install_module(core, "Bad-Name")


def test_ai_db(tmp_path):
    path = tmp_path / "ai.db"
    con = db.create_ai(path)
    con.executescript(
        """
        INSERT INTO embedding_model (id, provider, name, dim) VALUES ('m@1', 'local', 'test', 4);
        INSERT INTO chunk (uri, kind, origin, start_vkey, end_vkey, year_from, text, content_hash)
          VALUES ('section:irenaeus.haer@anf#3.11.6', 'work-section', 'core', 43001018, 43001018, 180,
                  'No one has seen God…', 'h1');
        """
    )
    con.execute("INSERT INTO embedding (chunk_id, model_id, vector) VALUES (1, 'm@1', ?)", (b"\x00" * 16,))
    with pytest.raises(sqlite3.IntegrityError):  # not a whole number of float32s
        con.execute("INSERT INTO embedding (chunk_id, model_id, vector) VALUES (1, 'm@1', ?)", (b"\x00" * 3,))
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(
            "INSERT INTO ai_proposal (kind, src, status, created_at) VALUES ('link', 'a:b', 'whatever', 'now')"
        )
    con.commit()
    con.close()
    db.open_ai(path).close()


def test_user_ai_conversation(tmp_path):
    con = db.migrate_user(tmp_path / "user.db")
    con.executescript(
        """
        INSERT INTO ai_conversation (id, anchor, settings, created_at, updated_at)
          VALUES ('c1', 'verse:John.1.18', '{"era": "ante-nicene"}', 'now', 'now');
        INSERT INTO ai_message (id, conversation_id, seq, role, content, citations, created_at)
          VALUES ('m1', 'c1', 1, 'assistant', '…', '[{"uri": "verse:John.1.18"}]', 'now');
        """
    )
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(
            "INSERT INTO ai_message (id, conversation_id, seq, role, content, created_at) "
            "VALUES ('m2', 'c1', 2, 'robot', 'x', 'now')"
        )
