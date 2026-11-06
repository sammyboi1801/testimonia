"""Universal references ("URIs") to any item in Testimonia.

Format: ``<type>:<id>[#<fragment>]``

    verse:John.1.18                     a verse (OSIS id)
    verse:John.1.18-John.1.20           a verse range
    book:John                           a book
    person:irenaeus                     a person (biblical figure, father, ruler…)
    work:irenaeus.haer                  an ancient work
    section:irenaeus.haer@anf#3.11.6    a section of one edition of a work
    ms:GA:P66                           a manuscript (ids may themselves contain ':')
    lemma:G3439                         a lexical entry
    edition:kjv                         a Bible edition / translation
    note:5f0c…                          a user note

URIs are the glue between core.db, user.db, ai.db, notes and AI citations. Adding a new kind of
entity only requires registering its type here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .refs import Range, parse_osis

#: Registered URI types → short description. Extend this when adding a new entity kind.
TYPES: dict[str, str] = {
    "verse": "Bible verse or verse range (OSIS)",
    "book": "Bible book (OSIS code)",
    "person": "person",
    "place": "place",
    "event": "event",
    "period": "named period / era (also realms: period:realm-judah)",
    "office": "an office held: a reign or term (office_holding id, e.g. hezekiah@judah)",
    "work": "ancient work",
    "section": "section of a work edition (id@edition#cite)",
    "ms": "manuscript",
    "lemma": "lexical entry",
    "lexicon": "lexicon article (lexicon#lemma)",
    "edition": "Bible edition / translation",
    "commentary": "commentary (commentary#vkey)",
    "topic": "topic",
    "canon": "ancient canon list",
    "media": "media asset",
    "note": "user note",
    "collection": "user collection",
    "conversation": "AI conversation",
}

_URI = re.compile(r"^(?P<type>[a-z][a-z0-9_-]*):(?P<id>[^#\s]+)(?:#(?P<frag>[^\s]+))?$")


class URIError(ValueError):
    """Raised for malformed or unknown-type URIs."""


@dataclass(frozen=True)
class URI:
    type: str
    id: str
    fragment: str | None = None

    def __str__(self) -> str:
        return f"{self.type}:{self.id}" + (f"#{self.fragment}" if self.fragment else "")

    def verse_range(self) -> Range:
        """For verse URIs, the parsed range (raises URIError otherwise)."""
        if self.type != "verse":
            raise URIError(f"not a verse URI: {self}")
        r = parse_osis(self.id)
        if r is None:
            raise URIError(f"bad verse reference in {self}")
        return r


def parse(text: str, *, strict: bool = True) -> URI:
    """Parse a URI string. With ``strict`` (default) the type must be registered in TYPES."""
    m = _URI.match(text.strip())
    if not m:
        raise URIError(f"malformed URI: {text!r}")
    uri = URI(m.group("type"), m.group("id"), m.group("frag"))
    if strict and uri.type not in TYPES:
        raise URIError(f"unknown URI type {uri.type!r} in {text!r}")
    if uri.type == "verse":
        uri.verse_range()  # validates
    return uri


def make(type_: str, id_: str, fragment: str | None = None) -> str:
    """Build a URI string, validating the type and id."""
    if type_ not in TYPES:
        raise URIError(f"unknown URI type {type_!r}")
    if not id_ or any(c.isspace() for c in id_) or "#" in id_:
        raise URIError(f"invalid id {id_!r}")
    return str(parse(str(URI(type_, id_, fragment))))


def verse(start_osis: str, end_osis: str | None = None) -> str:
    """verse('John.1.18') → 'verse:John.1.18'; verse('John.1.18', 'John.1.20') → range."""
    ident = start_osis if not end_osis or end_osis == start_osis else f"{start_osis}-{end_osis}"
    return make("verse", ident)
