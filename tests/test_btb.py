"""BTB-specific parsing: chronology strings and front-matter."""

from __future__ import annotations

import pytest

from testimonia.ingest import btb


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("~AD 30", (30, 30, True)),
        ("~AD 27–29", (27, 29, True)),
        ("~593–571 BC", (-592, -570, True)),
        ("~5–4 BC", (-4, -3, True)),
        ("~1446 BC", (-1445, -1445, True)),
        ("Before ~2166 BC", (None, -2165, True)),
        ("586 BC", (-585, -585, False)),
        ("sometime", (None, None, False)),
    ],
)
def test_parse_btb_date(text, expected):
    assert btb.parse_btb_date(text) == expected


def test_slug():
    assert btb.slug("The Life of Christ: Early Ministry") == "the-life-of-christ-early-ministry"


def test_split_frontmatter():
    fm, body = btb._split_frontmatter("---\ntitle: John 1:1\njesus_said: true\n---\nbody text")
    assert fm == {"title": "John 1:1", "jesus_said": True}
    assert body == "body text"
    assert btb._split_frontmatter("no front matter") == ({}, "no front matter")


def _vault():
    from testimonia import config, fetch, sources

    for p in fetch.resolve_paths(sources.load().get("btb")):
        if (p / "interlinear").is_dir():
            return p
    return config.RAW_DIR / "btb-missing"


@pytest.mark.skipif(not (_vault() / "interlinear").is_dir(), reason="BTB vault not available")
def test_fast_frontmatter_matches_yaml_on_real_files():
    import itertools

    import yaml

    def as_strings(value):
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, list):
            return [as_strings(v) for v in value]
        return str(value)

    # Compare against YAML's string-only loader: the default YAML 1.1 resolver would turn edition
    # codes such as `NO` into booleans (the "Norway problem"), which the BTB parser deliberately avoids.
    files = itertools.islice(btb._markdown_files(_vault() / "interlinear"), 0, None, 97)  # spread sample
    checked = 0
    for path in itertools.islice(files, 300):
        text = path.read_text(encoding="utf-8")
        block = text[4 : text.find("\n---\n", 4)]
        fast = {k: as_strings(v) for k, v in btb.parse_frontmatter(block).items()}
        assert fast == yaml.load(block, Loader=yaml.BaseLoader), path.name
        checked += 1
    assert checked > 100


def test_edition_code_no_is_not_a_boolean():
    assert btb.parse_frontmatter("texts:\n- NKO\n- NO") == {"texts": ["NKO", "NO"]}
