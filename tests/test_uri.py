"""Universal URIs."""

from __future__ import annotations

import pytest

from testimonia import uri


@pytest.mark.parametrize(
    ("text", "type_", "id_", "frag"),
    [
        ("verse:John.1.18", "verse", "John.1.18", None),
        ("verse:John.1.18-John.1.20", "verse", "John.1.18-John.1.20", None),
        ("person:irenaeus", "person", "irenaeus", None),
        ("section:irenaeus.haer@anf#3.11.6", "section", "irenaeus.haer@anf", "3.11.6"),
        ("ms:GA:P66", "ms", "GA:P66", None),
        ("lemma:G3439", "lemma", "G3439", None),
        ("commentary:matthew-henry#43001001", "commentary", "matthew-henry", "43001001"),
    ],
)
def test_parse_roundtrip(text, type_, id_, frag):
    u = uri.parse(text)
    assert (u.type, u.id, u.fragment) == (type_, id_, frag)
    assert str(u) == text


def test_verse_range():
    r = uri.parse("verse:John.1.18-John.1.20").verse_range()
    assert (r.start, r.end) == (43_001_018, 43_001_020)


@pytest.mark.parametrize(
    "bad",
    ["", "John.1.18", "verse:", "verse:Nope.1.1", "Person:x", "person:has space", "unknowntype:x"],
)
def test_rejects_bad(bad):
    with pytest.raises(uri.URIError):
        uri.parse(bad)


def test_non_strict_allows_new_types():
    assert uri.parse("audio:track-1", strict=False).type == "audio"


def test_make_and_verse_helpers():
    assert uri.verse("John.1.18") == "verse:John.1.18"
    assert uri.verse("John.1.18", "John.1.20") == "verse:John.1.18-John.1.20"
    assert uri.make("ms", "GA:01") == "ms:GA:01"
    with pytest.raises(uri.URIError):
        uri.make("ms", "has#hash")
    with pytest.raises(uri.URIError):
        uri.make("nope", "x")
