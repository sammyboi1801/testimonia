"""Pipeline infrastructure: build planning, CLI, fetch safety, licence gate."""

from __future__ import annotations

import zipfile

import pytest

from testimonia import build, cli, fetch
from testimonia.ingest import STEPS, base, ebible
from testimonia.sources import FetchItem, Source

# ----------------------------------------------------------------------------- build planning


def test_plan_orders_dependencies():
    order = [s.id for s in build.plan()]
    assert order.index("curated") < order.index("ebible") < order.index("verses")


def test_plan_only_pulls_dependencies():
    assert [s.id for s in build.plan(["ebible"])] == ["curated", "ebible"]


def test_plan_unknown_step():
    with pytest.raises(build.BuildError, match="unknown ingest step"):
        build.plan(["nope"])


def test_plan_detects_cycles(monkeypatch):
    monkeypatch.setitem(STEPS, "a", base.Step("a", lambda c: None, (), ("b",), False, ""))
    monkeypatch.setitem(STEPS, "b", base.Step("b", lambda c: None, (), ("a",), False, ""))
    with pytest.raises(build.BuildError, match="cycle"):
        build.plan(["a"])


# ----------------------------------------------------------------------------- CLI


def test_cli_sources_and_credits(capsys):
    assert cli.main(["sources"]) == 0
    assert "stepbible-tagnt" in capsys.readouterr().out
    assert cli.main(["credits", "--check"]) == 0


def test_cli_version():
    with pytest.raises(SystemExit) as exc:
        cli.main(["--version"])
    assert exc.value.code == 0


def test_cli_reports_errors_cleanly(monkeypatch):
    def boom(args):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(cli, "cmd_info", boom)
    assert cli.main(["info"]) == 1


# ----------------------------------------------------------------------------- fetch


def test_safe_extract_rejects_path_traversal(tmp_path):
    archive = tmp_path / "evil.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../outside.txt", "nope")
    with pytest.raises(fetch.FetchError, match="unsafe path"):
        fetch._safe_extract_zip(archive, tmp_path / "out")
    assert not (tmp_path / "outside.txt").exists()


def test_safe_extract_ok(tmp_path):
    archive = tmp_path / "ok.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("dir/file.txt", "hello")
    fetch._safe_extract_zip(archive, tmp_path / "out")
    assert (tmp_path / "out" / "dir" / "file.txt").read_text() == "hello"


def test_resolve_paths_prefers_local_copy(tmp_path, monkeypatch):
    local = tmp_path / "vault"
    local.mkdir()
    src = Source(
        id="btb",
        name="BTB",
        license="CC-BY-SA-4.0",
        attribution="x",
        fetch=(FetchItem(kind="local", env="BTB", target="btb"), FetchItem(kind="git", url="u", target="btb")),
    )
    monkeypatch.setattr(fetch.config, "setting", lambda name, default=None: str(local) if name == "BTB" else default)
    assert fetch.resolve_paths(src) == [local]
    monkeypatch.setattr(fetch.config, "setting", lambda name, default=None: default)
    assert fetch.resolve_paths(src) == [fetch.config.RAW_DIR / "btb"]


def test_lock_key_is_stable():
    item = FetchItem(kind="http", url="https://x/y.zip", target="t")
    assert fetch.lock_key(item) == fetch.lock_key(FetchItem(kind="http", url="https://x/y.zip", target="t"))


# ----------------------------------------------------------------------------- eBible licence gate & cleaning

OPEN_ROW = {"Redistributable": "True", "Copyright": "public domain"}


def test_licence_gate_accepts_open():
    assert ebible._check_licence("x", OPEN_ROW, "")
    cc = {"Redistributable": "True", "Copyright": "Copyright © 2020 Someone"}
    about = "This translation is made available under the Creative Commons Attribution Share-Alike license 4.0."
    assert ebible._check_licence("x", cc, about)


@pytest.mark.parametrize(
    ("row", "about"),
    [
        (None, ""),
        ({"Redistributable": "False", "Copyright": "public domain"}, ""),
        ({"Redistributable": "True", "Copyright": "Copyright © 2020 X"}, ""),
        (
            {"Redistributable": "True", "Copyright": "Copyright © 2020 X"},
            "Creative Commons Attribution 4.0 … NonCommercial use only",
        ),
    ],
)
def test_licence_gate_refuses(row, about):
    with pytest.raises(base.IngestError):
        ebible._check_licence("x", row, about)


def test_clean_paragraph_marks():
    assert ebible.clean("¶ And God said") == ("And God said", "<p/>And God said")
    assert ebible.clean("In the beginning ") == ("In the beginning", None)


# ----------------------------------------------------------------------------- public builds


def test_purge_non_public_removes_rows_and_dependents(tmp_path):
    from testimonia import db

    con = db.create_core(tmp_path / "core.db")
    con.executescript(
        """
        INSERT INTO source (id, name, license, public) VALUES ('open', 'Open', 'PD', 1), ('local', 'Local', 'PD', 0);
        INSERT INTO book (osis, ord, name, testament) VALUES ('John', 43, 'John', 'NT');
        INSERT INTO verse (vkey, osis, book, chapter, verse) VALUES (43001001, 'John.1.1', 'John', 1, 1);
        INSERT INTO edition (id, title, language, kind, source_id) VALUES
            ('pub', 'Public text', 'eng', 'translation', 'open'),
            ('loc', 'Local text', 'eng', 'translation', 'local');
        INSERT INTO edition_verse (edition_id, vkey, text) VALUES ('pub', 43001001, 'a'), ('loc', 43001001, 'b');
        INSERT INTO commentary (id, title, kind, source_id) VALUES ('c', 'Later author', 'patristic-excerpts', 'local');
        INSERT INTO commentary_entry (commentary_id, start_vkey, end_vkey, html) VALUES ('c', 43001001, 43001001, 'x');
        """
    )
    removed = build.purge_non_public(con)
    assert removed == 4  # edition + its verse, commentary + its entry
    assert [r[0] for r in con.execute("SELECT edition_id FROM edition_verse")] == ["pub"]
    assert con.execute("SELECT count(*) FROM commentary_entry").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM source").fetchone()[0] == 2  # provenance rows are kept
