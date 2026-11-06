"""The source manifest is valid, open-only, and CREDITS.md is in sync with it."""

from __future__ import annotations

import pytest

from testimonia import credits, sources


@pytest.fixture(scope="module")
def manifest() -> sources.Manifest:
    return sources.load()


def test_manifest_loads_and_is_open(manifest):
    assert manifest.sources
    assert all(s.is_open for s in manifest.sources.values())


def test_every_source_has_attribution(manifest):
    assert all(s.attribution.strip() for s in manifest.sources.values())


def test_rejects_non_open_licence(tmp_path):
    p = tmp_path / "m.yaml"
    p.write_text("sources:\n  - {id: x, name: X, license: CC-BY-NC-4.0, attribution: x}\n", encoding="utf-8")
    with pytest.raises(sources.ManifestError):
        sources.load(p)


def test_rejects_included_and_excluded(tmp_path):
    p = tmp_path / "m.yaml"
    p.write_text(
        "sources:\n  - {id: x, name: X, license: PD, attribution: x}\nexcluded:\n  - {id: x, reason: r}\n",
        encoding="utf-8",
    )
    with pytest.raises(sources.ManifestError):
        sources.load(p)


def test_credits_file_current(manifest):
    assert credits.is_current(manifest), "CREDITS.md is stale: run `python -m testimonia credits`"
