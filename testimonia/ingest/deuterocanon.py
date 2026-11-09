"""The deuterocanon as part of the Bible: places, people, parallel passages and section headings.

The open datasets behind the rest of the Bible (OpenBible cross references, Theographic places and people,
the BTB section headings) stop at the 66-book canon. This step fills the gap for Tobit, Judith, Wisdom,
Sirach, Baruch, the Maccabees, the Additions and the rest:

* places — tagged by name in the KJV and Brenton texts, only where a name points to one known place;
* people — the books' own figures (curated/deuterocanon_people.csv), tagged by name within their books;
* parallel passages — well-established parallels and echoes (curated/deuterocanon_parallels.csv), both ways;
* section headings — Testimonia's own outlines (curated/deuterocanon_headings.csv).
"""

from __future__ import annotations

import json
import re
from collections import defaultdict

from ..books import BY_OSIS
from ..refs import parse_refs, vkey
from .base import Context, IngestError, step
from .curated import SOURCE, read_csv

#: names that read as ordinary words or belong to people in these books
STOP = {"Lower", "Proud", "Proud One", "Rahab", "Salem", "Sion", "Judah", "Israel", "Jacob", "Shem", "Ham"}
#: names shared by two places, settled for these books
OVERRIDE = {"Antioch": "antioch-1", "Ecbatane": "ecbatana", "Nineve": "nineveh"}
EDITIONS = ("kjva", "brenton")


def _dc_books() -> list[str]:
    return [b.osis for b in BY_OSIS.values() if b.testament == "DC"]


@step("deuterocanon", sources=[SOURCE], requires=["btb", "theographic", "openbible-xref"])
def ingest_deuterocanon(ctx: Context) -> None:
    """Places, people, parallels and headings for the deuterocanonical books."""
    books = _dc_books()
    spans = {b: (vkey(b, 0, 0), vkey(b, 999, 999)) for b in books}
    texts: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for b, (lo, hi) in spans.items():
        marks = ",".join("?" * len(EDITIONS))
        for k, text in ctx.con.execute(
            f"SELECT vkey, text FROM edition_verse WHERE edition_id IN ({marks}) AND vkey BETWEEN ? AND ?",
            (*EDITIONS, lo, hi),
        ):
            texts[b].append((k, text))

    # ---------------------------------------------------------------- places
    people_names = {r[0] for r in ctx.con.execute("SELECT name FROM person")}
    # a name that is also an ordinary word in these texts ('There') is not a place
    words = {w for b in books for _k, t in texts[b] for w in re.findall(r"\b[a-z]+\b", t)}
    verses = dict(ctx.con.execute("SELECT place_id, count(*) FROM place_ref GROUP BY place_id").fetchall())
    best: dict[str, tuple[int, str]] = {}
    for pid, name, alts in ctx.con.execute("SELECT id, name, alt_names FROM place WHERE lat IS NOT NULL"):
        if pid not in verses or name.lower() in words:
            continue  # only places the rest of the Bible names (so the atlas knows them), never a common word
        forms = [name] + [a for a in (json.loads(alts) if alts else []) if " " not in a and len(a) >= 5]
        for f in forms:
            ok = len(f) >= 4 and f[0].isupper() and f not in STOP and f not in people_names and f.lower() not in words
            # several places share a name (Jerusalem, Antioch): the one the Bible names most is meant
            if ok and verses[pid] > best.get(f, (0, ""))[0]:
                best[f] = (verses[pid], pid)
    names = {f: pid for f, (_n, pid) in best.items()}
    names.update(OVERRIDE)
    pattern = re.compile(r"\b(" + "|".join(sorted(map(re.escape, names), key=len, reverse=True)) + r")\b")
    place_rows = {(names[m.group(1)], k) for b in books for k, t in texts[b] for m in pattern.finditer(t)}
    ctx.insert("place_ref", ["place_id", "vkey"], sorted(place_rows), mode="OR IGNORE")

    # ---------------------------------------------------------------- people
    person_rows: list[tuple[str | None, ...]] = []
    refs: set[tuple[str, int]] = set()
    for p in read_csv("deuterocanon_people.csv", ("id", "name", "books", "match")):
        forms = p["match"].split("|")
        person_rows.append(
            (p["id"], p["name"], json.dumps(forms), p.get("sex") or None, "biblical", p.get("summary") or None)
        )
        rx = re.compile(r"\b(" + "|".join(map(re.escape, forms)) + r")\b")
        for b in p["books"].split("|"):
            if b not in spans:
                raise IngestError(f"deuterocanon_people.csv: unknown book {b!r} for {p['id']}")
            refs.update((p["id"], k) for k, t in texts[b] if rx.search(t))
    ctx.insert("person", ["id", "name", "alt_names", "sex", "kind", "summary"], person_rows, mode="OR IGNORE")
    ctx.insert("person_ref", ["person_id", "vkey"], sorted(refs), mode="OR IGNORE")

    # ---------------------------------------------------------------- parallel passages (both ways)
    xrefs: list[tuple[int, int, int, int, str]] = []
    bad: list[str] = []
    for row in read_csv("deuterocanon_parallels.csv", ("from", "to")):
        src, dst = parse_refs(row["from"]), parse_refs(row["to"])
        if not src or not dst:
            bad.append(f"{row['from']} → {row['to']}")
            continue
        for x in src:
            for y in dst:
                xrefs.append((x.start, x.end, y.start, y.end, SOURCE))
                xrefs.append((y.start, y.end, x.start, x.end, SOURCE))
    if bad:
        raise IngestError(f"deuterocanon_parallels.csv: unreadable references: {'; '.join(bad)}")
    ctx.insert("crossref", ["src_start", "src_end", "dst_start", "dst_end", "source_id"], xrefs)

    # ---------------------------------------------------------------- section headings
    by_book: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for h in read_csv("deuterocanon_headings.csv", ("book", "start", "title")):
        if h["book"] not in spans:
            raise IngestError(f"deuterocanon_headings.csv: unknown book {h['book']!r}")
        ch, v = (int(x) for x in h["start"].split(":"))
        by_book[h["book"]].append((vkey(h["book"], ch, v), h["title"]))
    heads: list[tuple[str, int, int, int, str, str]] = []
    for b, hs in by_book.items():
        hs.sort()
        last = ctx.con.execute("SELECT max(vkey) FROM verse WHERE book = ?", (b,)).fetchone()[0] or spans[b][1]
        for i, (start, title) in enumerate(hs):
            end = hs[i + 1][0] - 1 if i + 1 < len(hs) else last
            heads.append(("btb-pericope", start, end, 1, title, SOURCE))
    ctx.insert("heading", ["scheme", "start_vkey", "end_vkey", "level", "title", "source_id"], heads)

    ctx.log.info(
        "  deuterocanon: %d place mentions, %d people (%d mentions), %d parallels, %d headings",
        len(place_rows),
        len(person_rows),
        len(refs),
        len(xrefs) // 2,
        len(heads),
    )
