"""Scripture reference parsing and verse keys."""

from __future__ import annotations

import pytest

from testimonia.books import BOOKS, BY_OSIS, resolve_book
from testimonia.refs import Range, id_to_key, key_to_parts, parse_osis, parse_refs, vkey


def labels(text: str) -> list[str]:
    return [r.label() for r in parse_refs(text)]


def test_book_table_consistent():
    assert len({b.osis for b in BOOKS}) == len(BOOKS)
    assert [b.order for b in BOOKS] == list(range(1, len(BOOKS) + 1))
    assert BY_OSIS["Gen"].order == 1
    assert BY_OSIS["Mal"].order == 39
    assert BY_OSIS["Matt"].order == 40
    assert BY_OSIS["Rev"].order == 66


@pytest.mark.parametrize(
    ("name", "osis"),
    [
        ("Genesis", "Gen"),
        ("Gen.", "Gen"),
        ("1 Cor.", "1Cor"),
        ("I Corinthians", "1Cor"),
        ("II Kings", "2Kgs"),
        ("Song of Songs", "Song"),
        ("Canticles", "Song"),
        ("Apoc.", "Rev"),
        ("Ecclus", "Sir"),
        ("Jn", "John"),
        ("Ps", "Ps"),
        ("Psalm", "Ps"),
        ("1 Jn", "1John"),
        ("Philem.", "Phlm"),
        ("the Gospel according to St. John", "John"),
        ("Qoheleth", "Eccl"),
    ],
)
def test_resolve_book(name, osis):
    assert resolve_book(name) == osis


def test_vkey_roundtrip():
    k = vkey("John", 1, 18)
    assert k == 43_001_018
    assert key_to_parts(k) == ("John", 1, 18)
    assert id_to_key("John.1.18") == k
    assert id_to_key("Nope.1.1") is None
    assert id_to_key("John.x.1") is None


@pytest.mark.parametrize(
    ("s", "expected"),
    [
        ("John.1.18", Range("John", 1, 18, 1, 18)),
        ("John.1", Range("John", 1, 0, 1, 999)),
        ("John.1.18-John.1.20", Range("John", 1, 18, 1, 20)),
        ("John.1.18-20", Range("John", 1, 18, 1, 20)),
        ("Gen.4.3-Gen.4.8", Range("Gen", 4, 3, 4, 8)),
        ("John.1.18-John.2.3", Range("John", 1, 18, 2, 3)),
    ],
)
def test_parse_osis(s, expected):
    assert parse_osis(s) == expected


def test_parse_osis_rejects_garbage():
    assert parse_osis("Foo.1.1") is None
    assert parse_osis("John 1:18") is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("John 1:18", ["John 1:18"]),
        ("Jn 1:1,14", ["John 1:1", "John 1:14"]),
        ("1 Cor. 13:4-7; 15:3, 5", ["1 Corinthians 13:4–7", "1 Corinthians 15:3", "1 Corinthians 15:5"]),
        ("Ps 23", ["Psalms 23"]),
        ("Ps 23; 24", ["Psalms 23", "Psalms 24"]),
        ("Jude 3", ["Jude 1:3"]),
        ("John 1:18-2:3", ["John 1:18–2:3"]),
        ("Matt 10:2, with Matt 27:55", ["Matthew 10:2", "Matthew 27:55"]),
        ("Gen 1:1; Exod 3:14", ["Genesis 1:1", "Exodus 3:14"]),
        ("Isa 7:14; 8:8, 10", ["Isaiah 7:14", "Isaiah 8:8", "Isaiah 8:10"]),
    ],
)
def test_parse_refs(text, expected):
    assert labels(text) == expected


def test_range_keys():
    r = parse_refs("John 1:1-5")[0]
    assert (r.start, r.end) == (43_001_001, 43_001_005)
    whole = parse_refs("Ps 23")[0]
    assert whole.start == vkey("Ps", 23, 1)
    assert whole.end == vkey("Ps", 23, 999)
