"""Reading aids: topic pages, reading plans and the Gospel synopsis (read-only over core.db)."""

from __future__ import annotations

import json
import math
import re
import threading
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..books import BY_OSIS
from ..refs import key_to_parts
from .api import OUTSIDE, _osis, _verse_key, store
from .store import Store

router = APIRouter(prefix="/api")

GOSPELS = ("Matt", "Mark", "Luke", "John")
PRE_NICENE = 325
FALLBACK = ("bsb", "kjva", "web")  # translations to fall back on when the requested one lacks a verse
OUTSIDE_SQL = ", ".join(f"'{c}'" for c in OUTSIDE)


def _texts(s: Store, keys_sql: str, params: Sequence[Any], edition: str) -> dict[int, str]:
    """Verse text in `edition` (or the first fallback translation that has it) for the keys selected by `keys_sql`."""
    order = [edition, *[e for e in FALLBACK if e != edition]]
    rank = {e: i for i, e in enumerate(order)}
    best: dict[int, tuple[int, str]] = {}
    for r in s.all(
        f"SELECT vkey, edition_id, text FROM edition_verse WHERE edition_id IN ({','.join('?' * len(order))}) "
        f"AND vkey IN ({keys_sql})",
        (*order, *params),
    ):
        r_ = rank[r["edition_id"]]
        if r["vkey"] not in best or r_ < best[r["vkey"]][0]:
            best[r["vkey"]] = (r_, r["text"])
    return {k: t for k, (_, t) in best.items()}


def _label(start: int, end: int) -> str:
    b, c1, v1 = key_to_parts(start)
    _, c2, v2 = key_to_parts(end)
    name = BY_OSIS[b].name
    if start == end:
        return f"{name} {c1}:{v1}"
    if c1 == c2:
        return f"{name} {c1}:{v1}–{v2}"
    return f"{name} {c1}:{v1}–{c2}:{v2}"


# ----------------------------------------------------------------------------- topics


@router.get("/topics")
def topics(request: Request, q: str = Query("", max_length=100)) -> dict[str, Any]:
    """The topical index, A–Z (optionally filtered by a word in the name), with the number of verses of each."""
    s = store(request)
    where, params = "", []
    if q.strip():
        where, params = "WHERE t.name LIKE ? ESCAPE '\\'", [f"%{_like(q.strip())}%"]
    rows = s.all(
        "SELECT t.id, t.name, (SELECT count(*) FROM topic_ref r WHERE r.topic_id = t.id) AS verses "
        f"FROM topic t {where} ORDER BY t.name COLLATE NOCASE",
        params,
    )
    return {"query": q, "topics": rows, "total": len(rows)}


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


TOPIC_VERSES = 400  # verses sent at once; bigger topics are browsed book by book


@router.get("/topic/{topic_id:path}")
def topic(
    request: Request, topic_id: str, edition: str = Query("bsb", max_length=40), book: str | None = None
) -> dict[str, Any]:
    s = store(request)
    t = s.one("SELECT id, name, body, source_id FROM topic WHERE id = ?", (topic_id,))
    if t is None:
        raise HTTPException(404, f"unknown topic {topic_id!r}")
    by_book = s.all(
        "SELECT b.osis AS book, b.name, b.testament, count(*) AS verses FROM topic_ref r "
        "JOIN book b ON b.ord = r.start_vkey / 1000000 WHERE r.topic_id = ? GROUP BY b.osis ORDER BY b.ord",
        (topic_id,),
    )
    total = sum(b["verses"] for b in by_book)
    lo, hi = 0, 999_999_999
    if book:
        if book not in BY_OSIS:
            raise HTTPException(404, f"unknown book {book!r}")
        lo = BY_OSIS[book].order * 1_000_000
        hi = lo + 999_999
    keys = [
        r["start_vkey"]
        for r in s.all(
            "SELECT DISTINCT start_vkey FROM topic_ref WHERE topic_id = ? AND start_vkey BETWEEN ? AND ? "
            "ORDER BY start_vkey LIMIT ?",
            (topic_id, lo, hi, TOPIC_VERSES + 1),
        )
    ]
    truncated = len(keys) > TOPIC_VERSES
    keys = keys[:TOPIC_VERSES]
    texts = _texts(s, ",".join("?" * len(keys)), keys, edition) if keys else {}
    verses = [{"vkey": k, "osis": _osis(k), "text": texts.get(k)} for k in keys]
    return {
        "topic": t,
        "books": by_book,
        "total": total,
        "book": book,
        "verses": verses,
        "truncated": truncated,
        "related": _related_topics(s, topic_id, t["body"] or ""),
        "fathers": _topic_fathers(s, topic_id),
        "connections": _topic_connections(s, topic_id, edition),
    }


def _related_topics(s: Store, topic_id: str, body: str) -> list[dict[str, Any]]:
    """Topics the entry refers to ("See NEBO"), then those sharing the most verses with it (cosine of the
    verse sets, so broad topics like GOD do not crowd out close ones)."""
    named = []
    for m in re.finditer(r'data-t="topic ([^"]+)"', body):
        tid = f"btb:{m.group(1)}"
        if tid != topic_id and tid not in named:
            named.append(tid)
    out: list[dict[str, Any]] = []
    if named:
        found = {
            r["id"]: r
            for r in s.all(
                f"SELECT id, name FROM topic WHERE id IN ({','.join('?' * len(named))})",
                named,
            )
        }
        out.extend({**found[n], "kind": "see"} for n in named if n in found)
    n_self = s.scalar("SELECT count(*) FROM topic_ref WHERE topic_id = ?", (topic_id,)) or 0
    if n_self:
        shared = s.all(
            "SELECT b.topic_id AS id, t.name, count(*) AS shared, "
            "(SELECT count(*) FROM topic_ref c WHERE c.topic_id = b.topic_id) AS size "
            "FROM topic_ref a JOIN topic_ref b ON b.start_vkey = a.start_vkey AND b.topic_id <> a.topic_id "
            "JOIN topic t ON t.id = b.topic_id WHERE a.topic_id = ? GROUP BY b.topic_id HAVING shared >= 3",
            (topic_id,),
        )
        for r in shared:
            r["score"] = r["shared"] / math.sqrt(n_self * max(r["size"], 1))
        shared.sort(key=lambda r: -r["score"])
        seen = {r["id"] for r in out}
        out.extend(
            {"id": r["id"], "name": r["name"], "kind": "shared", "shared": r["shared"]}
            for r in shared[:12]
            if r["id"] not in seen
        )
    return out[:16]


def _topic_fathers(s: Store, topic_id: str) -> list[dict[str, Any]]:
    """Church fathers who cite the topic's verses: pre-Nicene writers first, then by how often."""
    rows = s.all(
        "SELECT c.author_id AS id, p.name, min(c.year) AS year, count(*) AS n, count(DISTINCT c.start_vkey) AS verses "
        "FROM topic_ref r JOIN citation c ON c.start_vkey = r.start_vkey JOIN work w ON w.id = c.work_id "
        f"JOIN person p ON p.id = c.author_id WHERE r.topic_id = ? AND w.category NOT IN ({OUTSIDE_SQL}) "
        "GROUP BY c.author_id",
        (topic_id,),
    )
    for r in rows:
        r["pre_nicene"] = r["year"] is not None and r["year"] <= PRE_NICENE
    rows.sort(key=lambda r: (not r["pre_nicene"], -r["n"], r["name"]))
    top = rows[:12]
    if not top:
        return top
    # one representative passage per writer: the earliest work, preferring a citation with its context
    samples = {
        r["author_id"]: r
        for r in s.all(
            "SELECT * FROM (SELECT c.author_id, c.work_id, w.title AS work_title, c.cite, c.edition_id, "
            "c.section_ord, c.start_vkey, c.snippet, row_number() OVER (PARTITION BY c.author_id "
            "ORDER BY c.year IS NULL, c.year, c.snippet IS NULL, c.id) AS rn "
            "FROM topic_ref t JOIN citation c ON c.start_vkey = t.start_vkey JOIN work w ON w.id = c.work_id "
            f"WHERE t.topic_id = ? AND c.author_id IN ({','.join('?' * len(top))})) WHERE rn = 1",
            (topic_id, *[r["id"] for r in top]),
        )
    }
    for r in top:
        sample = samples.get(r["id"])
        if sample:
            sample.pop("rn", None)
            sample["osis"] = _osis(sample["start_vkey"])
        r["sample"] = sample
    return top


def _topic_connections(s: Store, topic_id: str, edition: str) -> list[dict[str, Any]]:
    """Cross references that join two verses of the topic (the strongest first, each pair once)."""
    rows = s.all(
        "SELECT x.src_start AS a, x.dst_start AS b, max(x.votes) AS votes FROM crossref x "
        "JOIN topic_ref ra ON ra.start_vkey = x.src_start AND ra.topic_id = ?1 "
        "JOIN topic_ref rb ON rb.start_vkey = x.dst_start AND rb.topic_id = ?1 "
        "WHERE x.src_start <> x.dst_start GROUP BY x.src_start, x.dst_start "
        "ORDER BY votes IS NULL, votes DESC LIMIT 200",
        (topic_id,),
    )
    pairs: dict[tuple[int, int], dict[str, Any]] = {}
    for r in rows:
        key = (min(r["a"], r["b"]), max(r["a"], r["b"]))
        if key not in pairs:
            pairs[key] = {"a": _osis(key[0]), "b": _osis(key[1]), "votes": r["votes"]}
        if len(pairs) >= 12:
            break
    return list(pairs.values())


# ----------------------------------------------------------------------------- reading plans

PLANS: list[dict[str, Any]] = [
    {
        "id": "canonical",
        "title": "The whole Bible in a year",
        "description": "Genesis to Revelation in canonical order, about 85 verses a day.",
        "days": 365,
    },
    {
        "id": "chronological",
        "title": "The Bible in the order it happened",
        "description": "Every chapter once, arranged by the BTB chronology: the Psalms beside David, the "
        "prophets beside the kings they addressed, the letters within Acts.",
        "days": 365,
    },
    {
        "id": "nt90",
        "title": "The New Testament in 90 days",
        "description": "Matthew to Revelation, about three chapters a day.",
        "days": 90,
    },
    {
        "id": "early-church",
        "title": "As the early church read it",
        "description": "The 100 passages the writers before Nicaea (AD 325) quoted most, one a day, in "
        "the order of the Bible — with who quoted them.",
        "days": 100,
    },
]
_PLAN_BY_ID = {p["id"]: p for p in PLANS}
_cache: dict[tuple[Path, str], dict[str, Any]] = {}
_lock = threading.Lock()


@router.get("/plans")
def plans() -> list[dict[str, Any]]:
    return PLANS


@router.get("/plan/{plan_id}")
def plan(request: Request, plan_id: str) -> dict[str, Any]:
    if plan_id not in _PLAN_BY_ID:
        raise HTTPException(404, f"unknown reading plan {plan_id!r}")
    s = store(request)
    key = (s.path, plan_id)
    with _lock:
        cached = _cache.get(key)
    if cached is None:
        builders: dict[str, Callable[[Store], list[list[dict[str, Any]]]]] = {
            "canonical": lambda st: _chapter_plan(_chapters(st, ("OT", "NT")), 365),
            "chronological": lambda st: _chapter_plan(_chronological_chapters(st), 365),
            "nt90": lambda st: _chapter_plan(_chapters(st, ("NT",)), 90),
            "early-church": _early_church_plan,
        }
        days = builders[plan_id](s)
        cached = {**_PLAN_BY_ID[plan_id], "days": [{"day": i + 1, "readings": r} for i, r in enumerate(days)]}
        with _lock:
            _cache[key] = cached
    return cached


Chapter = tuple[str, int, int]  # (book, chapter, verses)


def _chapters(s: Store, testaments: tuple[str, ...]) -> list[Chapter]:
    marks = ",".join("?" * len(testaments))
    return [
        (r["book"], r["chapter"], r["n"])
        for r in s.all(
            "SELECT v.book, v.chapter, count(*) AS n, min(v.vkey) AS k FROM verse v JOIN book b ON b.osis = v.book "
            f"WHERE b.testament IN ({marks}) AND v.verse > 0 GROUP BY v.book, v.chapter ORDER BY k",
            testaments,
        )
    ]


def _chronological_chapters(s: Store) -> list[Chapter]:
    """Chapters of the Protestant canon in BTB chronological order (canonical order breaks ties and fills gaps)."""
    order = {
        (r["book"], r["chapter"]): r["o"]
        for r in s.all(
            "SELECT v.book, v.chapter, min(d.chron_order) AS o FROM verse_date d JOIN verse v ON v.vkey = d.vkey "
            "WHERE d.system_id = 'btb' AND d.chron_order IS NOT NULL GROUP BY v.book, v.chapter"
        )
    }
    chapters = _chapters(s, ("OT", "NT"))
    if not order:
        return chapters
    position = {c[:2]: i for i, c in enumerate(chapters)}
    # a chapter without a date reads right after the chapter before it
    last = 0.0
    keyed = []
    for c in chapters:
        o = order.get(c[:2])
        last = float(o) if o is not None else last + 0.001
        keyed.append((last, position[c[:2]], c))
    return [c for _, _, c in sorted(keyed)]


def _chapter_plan(chapters: list[Chapter], days: int) -> list[list[dict[str, Any]]]:
    """Split chapters into `days` portions of about equal length (in verses), keeping chapters whole."""
    total = sum(c[2] for c in chapters) or 1
    n = len(chapters)
    out: list[list[Chapter]] = [[] for _ in range(days)]
    done, prev = 0, -1
    for i, c in enumerate(chapters):
        # the day this chapter's middle falls on — never skipping a day, never leaving a day without a chapter
        day = min(int((done + c[2] / 2) * days / total), prev + 1)
        day = min(max(day, prev, days - (n - i), 0), days - 1)
        out[day].append(c)
        done += c[2]
        prev = day
    return [_readings(d) for d in out if d]


def _readings(chapters: list[Chapter]) -> list[dict[str, Any]]:
    """Consecutive chapters of one book become one reading: 'Genesis 1–3'."""
    groups: list[list[Chapter]] = []
    for c in chapters:
        if groups and groups[-1][-1][0] == c[0] and groups[-1][-1][1] + 1 == c[1]:
            groups[-1].append(c)
        else:
            groups.append([c])
    out = []
    for g in groups:
        book, first, last = g[0][0], g[0][1], g[-1][1]
        name = BY_OSIS[book].name
        out.append(
            {
                "label": f"{name} {first}" if first == last else f"{name} {first}–{last}",
                "book": book,
                "chapters": [c[1] for c in g],
                "osis": f"{book}.{first}.1",
                "verses": sum(c[2] for c in g),
            }
        )
    return out


def _early_church_plan(s: Store) -> list[list[dict[str, Any]]]:
    """The pericopes most cited before Nicaea (BTB headings), one a day, in canonical order."""
    rows = s.all(
        "SELECT h.start_vkey, h.end_vkey, h.title, count(c.id) AS n FROM heading h "
        "JOIN citation c ON c.start_vkey BETWEEN h.start_vkey AND h.end_vkey JOIN work w ON w.id = c.work_id "
        f"WHERE h.scheme = 'btb-pericope' AND c.year <= ? AND w.category NOT IN ({OUTSIDE_SQL}) "
        "GROUP BY h.id ORDER BY n DESC, h.start_vkey LIMIT 100",
        (PRE_NICENE,),
    )
    rows.sort(key=lambda r: r["start_vkey"])
    days = []
    for r in rows:
        who = s.all(
            "SELECT p.name, count(*) AS n FROM citation c JOIN person p ON p.id = c.author_id "
            "JOIN work w ON w.id = c.work_id WHERE c.start_vkey BETWEEN ? AND ? AND c.year <= ? "
            f"AND w.category NOT IN ({OUTSIDE_SQL}) GROUP BY p.id ORDER BY n DESC, min(c.year) LIMIT 3",
            (r["start_vkey"], r["end_vkey"], PRE_NICENE),
        )
        b, c, _ = key_to_parts(r["start_vkey"])
        days.append(
            [
                {
                    "label": _label(r["start_vkey"], r["end_vkey"]),
                    "title": r["title"],
                    "book": b,
                    "chapters": [c],
                    "osis": _osis(r["start_vkey"]),
                    "end_osis": _osis(r["end_vkey"]),
                    "citations": r["n"],
                    "cited_by": [w["name"] for w in who],
                }
            ]
        )
    return days


# ----------------------------------------------------------------------------- Gospel synopsis


def _sections(s: Store) -> list[dict[str, Any]]:
    """Every synopsis section with its passages per Gospel, in the order of the BTB chronology."""
    groups = s.all("SELECT id, title, source_id FROM parallel_group WHERE kind = 'synoptic'")
    members: dict[str, list[dict[str, Any]]] = {}
    for m in s.all(
        "SELECT group_id, start_vkey, end_vkey, role FROM parallel_member m "
        "JOIN parallel_group g ON g.id = m.group_id WHERE g.kind = 'synoptic' ORDER BY start_vkey"
    ):
        members.setdefault(m["group_id"], []).append(m)
    chron = {
        r["ch"]: r["o"]
        for r in s.all(
            "SELECT vkey / 1000 AS ch, min(chron_order) AS o FROM verse_date WHERE system_id = 'btb' "
            "AND vkey BETWEEN 40000000 AND 43999999 GROUP BY vkey / 1000"
        )
    }

    def when(k: int) -> tuple[float, int, int]:
        return (chron.get(k // 1000, math.inf), k % 1000, k)

    out = []
    for g in groups:
        ms = members.get(g["id"], [])
        if not ms:
            continue
        by: dict[str, list[dict[str, Any]]] = {}
        for m in ms:
            book = key_to_parts(m["start_vkey"])[0]
            by.setdefault(book, []).append(
                {
                    "osis": _osis(m["start_vkey"]),
                    "end_osis": _osis(m["end_vkey"]),
                    "label": _label(m["start_vkey"], m["end_vkey"]),
                    "anchor": m["role"] == "anchor",
                }
            )
        anchor = next((m for m in ms if m["role"] == "anchor"), ms[0])
        out.append(
            {
                "id": g["id"],
                "title": g["title"],
                "source": g["source_id"],
                "anchor": _osis(anchor["start_vkey"]),
                "passages": {b: by[b] for b in GOSPELS if b in by},
                "_key": min(when(m["start_vkey"]) for m in ms),
            }
        )
    out.sort(key=lambda r: r.pop("_key"))
    for i, r in enumerate(out):
        r["n"] = i + 1
    return out


_sections_cache: dict[Path, list[dict[str, Any]]] = {}


def _all_sections(s: Store) -> list[dict[str, Any]]:
    with _lock:
        hit = _sections_cache.get(s.path)
    if hit is None:
        hit = _sections(s)
        with _lock:
            _sections_cache[s.path] = hit
    return hit


@router.get("/parallels")
def parallels(request: Request, verse: str | None = Query(None, max_length=40)) -> dict[str, Any]:
    """The synopsis sections (or only those containing `verse`)."""
    s = store(request)
    sections = _all_sections(s)
    if verse:
        k = _verse_key(verse)
        hits = {
            r["group_id"]
            for r in s.all(
                "SELECT m.group_id FROM parallel_member m JOIN parallel_group g ON g.id = m.group_id "
                "WHERE g.kind = 'synoptic' AND m.start_vkey <= ? AND m.end_vkey >= ?",
                (k, k),
            )
        }
        sections = [x for x in sections if x["id"] in hits]
    return {"sections": sections, "gospels": [{"osis": g, "name": BY_OSIS[g].name} for g in GOSPELS]}


@router.get("/parallel/{group_id}")
def parallel(request: Request, group_id: str, edition: str = Query("bsb", max_length=40)) -> dict[str, Any]:
    """One synopsis section: each Gospel's passages verse by verse, in a translation and in Greek (NA28 words),
    with the UBS word-agreement codes where they line up with the Greek words."""
    s = store(request)
    sections = _all_sections(s)
    idx = next((i for i, x in enumerate(sections) if x["id"] == group_id), None)
    if idx is None:
        raise HTTPException(404, f"unknown synopsis section {group_id!r}")
    section = sections[idx]
    members = s.all(
        "SELECT start_vkey, end_vkey, role, match_data FROM parallel_member WHERE group_id = ? ORDER BY start_vkey",
        (group_id,),
    )
    columns: dict[str, list[dict[str, Any]]] = {}
    for m in members:
        lo, hi = m["start_vkey"], m["end_vkey"]
        codes: dict[str, str] = json.loads(m["match_data"]) if m["match_data"] else {}
        verses = s.all(
            "SELECT vkey, chapter, verse FROM verse WHERE vkey BETWEEN ? AND ? AND verse > 0 ORDER BY vkey", (lo, hi)
        )
        texts = _texts(s, "SELECT vkey FROM verse WHERE vkey BETWEEN ? AND ?", (lo, hi), edition)
        greek: dict[int, list[dict[str, Any]]] = {}
        for w in s.all(
            "SELECT vkey, surface, lemma_id, gloss FROM token WHERE edition_id = 'tagnt' "
            "AND vkey BETWEEN ? AND ? AND editions LIKE '%NA28%' ORDER BY vkey, pos",
            (lo, hi),
        ):
            greek.setdefault(w.pop("vkey"), []).append(w)
        rows = []
        for v in verses:
            k = v["vkey"]
            words = greek.get(k, [])
            c = codes.get(str(k))
            rows.append(
                {
                    "osis": _osis(k),
                    "chapter": v["chapter"],
                    "verse": v["verse"],
                    "text": texts.get(k),
                    "greek": words,
                    "codes": c if c and len(c) == len(words) else None,
                }
            )
        book = key_to_parts(lo)[0]
        columns.setdefault(book, []).append(
            {
                "osis": _osis(lo),
                "end_osis": _osis(hi),
                "label": _label(lo, hi),
                "anchor": m["role"] == "anchor",
                "verses": rows,
            }
        )
    return {
        "id": section["id"],
        "n": section["n"],
        "title": section["title"],
        "source": section["source"],
        "edition": edition,
        "columns": [
            {"gospel": g, "name": BY_OSIS[g].name, "passages": columns.get(g, [])} for g in GOSPELS if g in columns
        ],
        "prev": _brief(sections[idx - 1]) if idx > 0 else None,
        "next": _brief(sections[idx + 1]) if idx + 1 < len(sections) else None,
        "total": len(sections),
    }


def _brief(x: dict[str, Any]) -> dict[str, Any]:
    return {"id": x["id"], "title": x["title"]}
