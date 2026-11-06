"""Gospel synopsis: parallel sections across Matthew, Mark, Luke and John.

Two steps:

* ``parallels`` turns the BTB pericope headings and the parallel references printed under them
  ("The Baptism of Jesus — Mark 1:9–11; Luke 3:21–22; John 1:29–34") into synopsis sections
  (``parallel_group`` kind 'synoptic' + one ``parallel_member`` per passage). A pericope whose verses
  already appear in an earlier section (Mark's copy of a Matthew section, say) does not start a new one.
* ``ubs-parallels`` reads the UBS Parallel Passage Database (CC BY-SA 4.0): verse-level parallels with a
  code for every Greek word (UBS5 text) saying whether it has a full (2), partial (1) or no (0) match in
  the parallel verse(s). The codes are attached to the members' ``match_data`` (one string per verse,
  aligned with the NA28 words of the TAGNT edition), and Gospel pericopes that BTB lists no parallels for
  but UBS does become sections of their own.
"""

from __future__ import annotations

import bisect
import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from ..books import BY_OSIS, resolve_book
from ..refs import key_to_parts, vkey
from ..versification import STEP_TO_OSIS, USFM_TO_STEP
from .base import Context, IngestError, step

UBS = "ubs-open"
BTB = "btb"
GOSPELS = ("Matt", "Mark", "Luke", "John")
_ORDS = {BY_OSIS[g].order: g for g in GOSPELS}
GOSPEL_LO, GOSPEL_HI = BY_OSIS["Matt"].order * 1_000_000, BY_OSIS["John"].order * 1_000_000 + 999_999
#: a pericope already shown in this share of its verses by earlier sections does not start its own
COVERED = 0.5
#: UBS-only sections need a parallel of at least this many consecutive verses
MIN_RUN = 2


def gospel(k: int) -> str | None:
    return _ORDS.get(k // 1_000_000)


@dataclass
class Section:
    id: str
    title: str
    anchor: tuple[int, int]
    members: list[tuple[int, int]]  # anchor first, then the parallels in canonical order
    source: str = BTB
    match: dict[tuple[int, int], dict[int, str]] = field(default_factory=dict)


def section_id(start: int) -> str:
    b, c, v = key_to_parts(start)
    return f"syn:{b}.{c}.{v}"


class Verses:
    """The Gospel verse keys present in the database, for counting verses in a range."""

    def __init__(self, keys: Iterable[int]) -> None:
        self.keys = sorted(k for k in keys if k % 1000)

    def within(self, lo: int, hi: int) -> list[int]:
        return self.keys[bisect.bisect_left(self.keys, lo) : bisect.bisect_right(self.keys, hi)]


def build_sections(
    pericopes: Sequence[tuple[int, int, str]],
    parallels: dict[int, list[tuple[int, int]]],
    verses: Verses,
    existing: Sequence[Section] = (),
    source: str = BTB,
) -> list[Section]:
    """Sections from Gospel pericopes (start, end, title) and their parallel ranges in other Gospels.

    Pericopes are taken in canonical order; one whose verses are mostly shown already (as a parallel
    in an earlier section) is skipped, so Mark's "Baptism of Jesus" does not repeat Matthew's.
    """
    shown: set[int] = set()
    for s in existing:
        for lo, hi in s.members:
            shown.update(verses.within(lo, hi))
    out: list[Section] = []
    for start, end, title in sorted(pericopes):
        home = gospel(start)
        others = sorted({r for r in parallels.get(start, []) if gospel(r[0]) not in (None, home)})
        if home is None or not others:
            continue
        own = verses.within(start, end)
        if own and sum(k in shown for k in own) >= COVERED * len(own):
            continue
        members = [(start, end), *others]
        for lo, hi in members:
            shown.update(verses.within(lo, hi))
        out.append(Section(section_id(start), title, (start, end), members, source))
    return out


# ------------------------------------------------------------------------------------------- UBS data


@dataclass(frozen=True)
class UbsRef:
    book: str
    verses: tuple[int, ...]  # verse keys in the order the codes run
    codes: str  # one digit per original-language word; 0 none, 1 partial, 2 full match (+3/+6 = line breaks)
    lang: str  # 'GRK' | 'HEB'


_REF = re.compile(r"^([1-4]?[A-Z]{2,3})\s+(\d+):([\d,\-\s]+)$")


def parse_ref(text: str) -> tuple[str, tuple[int, ...]] | None:
    """'LUK 6:27-28,35' → ('Luke', (Luke.6.27, Luke.6.28, Luke.6.35)) as verse keys."""
    m = _REF.match(text.strip())
    if not m:
        return None
    code = m.group(1)
    book = STEP_TO_OSIS.get(USFM_TO_STEP.get(code, "").lower()) or resolve_book(code)  # Paratext (USFM) codes
    if book is None or book not in BY_OSIS:
        return None
    ch = int(m.group(2))
    keys: list[int] = []
    for part in m.group(3).replace(" ", "").split(","):
        if not part:
            continue
        a, _, b = part.partition("-")
        if not a.isdigit() or (b and not b.isdigit()):
            return None
        lo, hi = int(a), int(b or a)
        if hi < lo:
            return None
        keys.extend(vkey(book, ch, v) for v in range(lo, hi + 1))
    return (book, tuple(keys)) if keys else None


def parse_passages(path: Path) -> list[list[UbsRef]]:
    """ParallelPassages.xml → passages, each a list of parallel references with their match codes."""
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    root = etree.parse(str(path), parser).getroot()
    out: list[list[UbsRef]] = []
    bad = 0
    for p in root.iter("Passage"):
        refs = []
        for v in p.iter("Verse"):
            lang = "GRK" if v.get("GRK") is not None else "HEB"
            codes = v.get(lang) or ""
            parsed = parse_ref(v.text or "")
            if parsed is None or not codes.isdigit():
                bad += 1
                continue
            refs.append(UbsRef(parsed[0], parsed[1], codes, lang))
        if len(refs) >= 2:
            out.append(refs)
    if bad > 50:
        raise IngestError(f"{bad} unreadable references in {path.name} — has the format changed?")
    return out


def split_codes(ref: UbsRef, words: dict[int, int]) -> dict[int, str] | None:
    """Per-verse match codes (0/1/2) when the word counts agree with the codes, else None."""
    counts = [words.get(k, 0) for k in ref.verses]
    if sum(counts) != len(ref.codes) or 0 in counts:
        return None
    flat = "".join(str(int(c) % 3) for c in ref.codes)
    out, i = {}, 0
    for k, n in zip(ref.verses, counts, strict=True):
        out[k] = flat[i : i + n]
        i += n
    return out


def merge_codes(a: str | None, b: str) -> str:
    """A word counts as matched if it matches in any of the parallels (the higher code wins)."""
    if a is None or len(a) != len(b):
        return b if a is None else a
    return "".join(max(x, y) for x, y in zip(a, b, strict=True))


def _inside(k: int, ranges: Iterable[tuple[int, int]]) -> bool:
    return any(lo <= k <= hi for lo, hi in ranges)


def attach_codes(sections: Sequence[Section], passages: Sequence[Sequence[UbsRef]], words: dict[int, int]) -> int:
    """Fill each section member's per-verse codes from the UBS passages that link it to another member."""
    split: dict[UbsRef, dict[int, str] | None] = {}
    done = 0
    gospel_passages = [[r for r in refs if r.book in GOSPELS] for refs in passages]
    for s in sections:
        for refs in gospel_passages:
            for r in refs:
                home = next((m for m in s.members if _inside(r.verses[0], [m])), None)
                if home is None:
                    continue
                others = [m for m in s.members if m != home]
                if not any(o.book != r.book and _inside(o.verses[0], others) for o in refs):
                    continue
                if r not in split:
                    split[r] = split_codes(r, words)
                codes = split[r]
                if codes is None:
                    continue
                per = s.match.setdefault(home, {})
                for k, c in codes.items():
                    if home[0] <= k <= home[1]:
                        per[k] = merge_codes(per.get(k), c)
                        done += 1
    return done


def ubs_links(passages: Sequence[Sequence[UbsRef]]) -> dict[int, list[int]]:
    """Gospel verse → the verses in *other* Gospels UBS lists as its parallels."""
    links: dict[int, set[int]] = {}
    for refs in passages:
        gospel_refs = [r for r in refs if r.book in GOSPELS]
        for r in gospel_refs:
            for o in gospel_refs:
                if o.book == r.book:
                    continue
                for k in r.verses:
                    links.setdefault(k, set()).update(o.verses)
    return {k: sorted(v) for k, v in links.items()}


def runs(keys: Iterable[int], verses: Verses, gap: int = 1) -> list[tuple[int, int]]:
    """Group verse keys into ranges, bridging up to `gap` missing verses within a book."""
    ks = sorted(set(keys))
    out: list[tuple[int, int]] = []
    for k in ks:
        if out and k // 1_000_000 == out[-1][1] // 1_000_000 and len(verses.within(out[-1][1], k)) <= gap + 2:
            out[-1] = (out[-1][0], k)
        else:
            out.append((k, k))
    return out


def ubs_parallel_ranges(
    pericopes: Sequence[tuple[int, int, str]], links: dict[int, list[int]], verses: Verses
) -> dict[int, list[tuple[int, int]]]:
    """Pericope start → parallel ranges in other Gospels, from the UBS verse links of its verses.

    Only runs of two or more verses count: a single shared saying ("He who has ears…") does not make a
    synopsis section."""
    out: dict[int, list[tuple[int, int]]] = {}
    for start, end, _ in pericopes:
        linked = [o for k in verses.within(start, end) for o in links.get(k, [])]
        kept = [r for r in runs(linked, verses) if len(verses.within(*r)) >= MIN_RUN]
        if kept:
            out[start] = kept
    return out


# ------------------------------------------------------------------------------------------- steps


def _pericopes(ctx: Context) -> list[tuple[int, int, str]]:
    return [
        (r[0], r[1], r[2])
        for r in ctx.con.execute(
            "SELECT start_vkey, end_vkey, title FROM heading WHERE scheme = 'btb-pericope' "
            "AND start_vkey BETWEEN ? AND ? ORDER BY start_vkey",
            (GOSPEL_LO, GOSPEL_HI),
        )
    ]


def _verses(ctx: Context) -> Verses:
    return Verses(
        r[0] for r in ctx.con.execute("SELECT vkey FROM verse WHERE vkey BETWEEN ? AND ?", (GOSPEL_LO, GOSPEL_HI))
    )


def _write(ctx: Context, sections: Sequence[Section]) -> None:
    ctx.insert(
        "parallel_group",
        ["id", "kind", "title", "source_id"],
        ((s.id, "synoptic", s.title, s.source) for s in sections),
    )
    ctx.insert(
        "parallel_member",
        ["group_id", "start_vkey", "end_vkey", "role"],
        ((s.id, lo, hi, "anchor" if (lo, hi) == s.anchor else None) for s in sections for lo, hi in s.members),
        mode="OR IGNORE",
    )


@step("parallels", requires=["btb"])
def ingest_synopsis(ctx: Context) -> None:
    """Gospel synopsis sections from the BTB pericopes and their parallel references."""
    pericopes = _pericopes(ctx)
    parallels: dict[int, list[tuple[int, int]]] = {}
    starts = {p[0] for p in pericopes}
    for src, lo, hi in ctx.con.execute(
        "SELECT src_start, dst_start, dst_end FROM crossref WHERE source_id = ? AND src_start BETWEEN ? AND ? "
        "AND dst_start BETWEEN ? AND ?",
        (BTB, GOSPEL_LO, GOSPEL_HI, GOSPEL_LO, GOSPEL_HI),
    ):
        if src in starts:
            parallels.setdefault(src, []).append((lo, hi))
    sections = build_sections(pericopes, parallels, _verses(ctx))
    _write(ctx, sections)
    ctx.log.info("  %d Gospel synopsis sections from %d pericopes", len(sections), len(pericopes))


@step("ubs-parallels", sources=[UBS], requires=["parallels", "stepbible-tagnt"])
def ingest_ubs_parallels(ctx: Context) -> None:
    """UBS Parallel Passage Database: word agreement between parallel Gospel verses (+ sections BTB lacks)."""
    passages = parse_passages(ctx.find(UBS, "ParallelPassages.xml"))
    gospel_passages = [p for p in passages if sum(r.book in GOSPELS for r in p) >= 2]
    if len(gospel_passages) < 500:
        raise IngestError(f"only {len(gospel_passages)} Gospel parallels in the UBS database — input looks truncated")
    verses = _verses(ctx)
    pericopes = _pericopes(ctx)
    existing: list[Section] = []
    for gid, title in ctx.con.execute("SELECT id, title FROM parallel_group WHERE kind = 'synoptic' ORDER BY id"):
        members = [
            (r[0], r[1], r[2])
            for r in ctx.con.execute(
                "SELECT start_vkey, end_vkey, role FROM parallel_member WHERE group_id = ? ORDER BY start_vkey", (gid,)
            )
        ]
        anchor = next(((lo, hi) for lo, hi, role in members if role == "anchor"), (members[0][0], members[0][1]))
        existing.append(Section(gid, title, anchor, [(lo, hi) for lo, hi, _ in members]))
    added = build_sections(
        pericopes, ubs_parallel_ranges(pericopes, ubs_links(gospel_passages), verses), verses, existing, source=UBS
    )
    added = [s for s in added if s.id not in {e.id for e in existing}]
    _write(ctx, added)
    # NA28 words per verse in TAGNT (the UBS codes count the words of UBS5 = NA28)
    words = {
        r[0]: r[1]
        for r in ctx.con.execute(
            "SELECT vkey, count(*) FROM token WHERE edition_id = 'tagnt' AND editions LIKE '%NA28%' "
            "AND vkey BETWEEN ? AND ? GROUP BY vkey",
            (GOSPEL_LO, GOSPEL_HI),
        )
    }
    sections = existing + added
    attach_codes(sections, gospel_passages, words)
    rows = [
        (json.dumps({str(k): c for k, c in sorted(per.items())}, separators=(",", ":")), s.id, lo)
        for s in sections
        for (lo, _hi), per in s.match.items()
        if per
    ]
    ctx.con.executemany("UPDATE parallel_member SET match_data = ? WHERE group_id = ? AND start_vkey = ?", rows)
    coded = sum(len(per) for s in sections for per in s.match.values())
    ctx.log.info(
        "  %d UBS Gospel parallels; %d more sections; word agreement for %d verses",
        len(gospel_passages),
        len(added),
        coded,
    )
