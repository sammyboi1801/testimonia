"""Manuscripts API: browse the catalogue, one manuscript's page, and the manuscripts behind a verse.

Images are never served or copied. New Testament manuscripts link to the INTF's New Testament Virtual Manuscript
Room (NTVMR), whose images belong to the holding institutions; Dead Sea Scrolls link to the Leon Levy library.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..books import BY_OSIS
from ..refs import key_to_parts
from .api import _osis, _verse_key, store

router = APIRouter(prefix="/api")

NTVMR = "https://ntvmr.uni-muenster.de"
DSS = "Dead Sea Scrolls"
NT_FIRST = BY_OSIS["Matt"].order
NT_LAST = BY_OSIS["Rev"].order

#: Earliest first by the middle of the date window, so a scroll dated only "Hellenistic-Roman" (250 BC – AD 68)
#: does not outrank one firmly dated to 150–100 BC; narrower windows first on ties.
EARLIEST = "m.date_from IS NULL, (m.date_from + m.date_to) / 2.0, m.date_to - m.date_from, m.id"

_COLUMNS = (
    "m.id, m.sigla, m.name, m.collection, m.language, m.date_from, m.date_to, m.date_label, m.script, "
    "m.institution, m.city, m.country"
)


def ntvmr_doc_id(ga: str) -> int | None:
    """Gregory–Aland number → NTVMR document id: P52 → 10052, 03 → 20003, 1739 → 31739 (lectionaries are not listed
    here). Verified against the NTVMR metadata API (docID=10052 → P52, 20046 → 046, 31739 → 1739)."""
    if m := re.fullmatch(r"P(\d{1,4})", ga):
        return 10_000 + int(m.group(1))
    if re.fullmatch(r"0\d{1,4}", ga):
        return 20_000 + int(ga)
    if re.fullmatch(r"[1-9]\d{0,3}", ga):
        return 30_000 + int(ga)
    return None


def ntvmr_links(ga: str | None) -> dict[str, str] | None:
    doc = ntvmr_doc_id(ga) if ga else None
    if doc is None:
        return None
    return {
        "images": f"{NTVMR}/manuscript-workspace?docID={doc}",
        "catalogue": f"{NTVMR}/liste?docID={doc}",
    }


def ntvmr_verse_url(k: int) -> str | None:
    """NTVMR's catalogue search for every Greek manuscript indexed as containing a verse (NT only)."""
    book, ch, v = key_to_parts(k)
    if not NT_FIRST <= BY_OSIS[book].order <= NT_LAST:
        return None
    return f"{NTVMR}/liste?indexContent={book}.{ch}.{v}"


def _span_label(a: int, b: int) -> str:
    """'John 18:31–33', 'Romans 1–16', 'Genesis 46:28 – Malachi'."""
    b1, c1, v1 = key_to_parts(a)
    b2, c2, v2 = key_to_parts(b)
    n1, n2 = BY_OSIS[b1].name, BY_OSIS[b2].name
    whole_start = v1 <= 1 and c1 <= 1
    end_ch = min(c2, BY_OSIS[b2].chapters or c2)
    whole_end = v2 >= 999 and (c2 >= 999 or c2 >= (BY_OSIS[b2].chapters or 999))
    if b1 != b2:
        left = n1 if whole_start else f"{n1} {c1}:{max(v1, 1)}"
        right = n2 if whole_end else (f"{n2} {end_ch}" if v2 >= 999 else f"{n2} {c2}:{v2}")
        return f"{left} – {right}"
    if whole_start and whole_end:
        return n1
    if v1 <= 1 and v2 >= 999:
        return f"{n1} {c1}" if c1 == end_ch else f"{n1} {c1}–{end_ch}"
    if c1 == c2:
        return f"{n1} {c1}:{v1}" if v1 == v2 else f"{n1} {c1}:{v1}–{v2 if v2 < 999 else 'end'}"
    return f"{n1} {c1}:{max(v1, 1)}–{end_ch}:{v2}" if v2 < 999 else f"{n1} {c1}:{max(v1, 1)}–{end_ch}"


def _contiguous(s: Any, end: int, start: int) -> bool:
    """Whether two ranges meet: no verse of the Bible lies between them (e.g. Isa 1:31 and Isa 2:1)."""
    if start <= end + 1:
        return True
    return bool(
        s.scalar(
            "SELECT EXISTS (SELECT 1 FROM verse WHERE vkey = ?) AND EXISTS (SELECT 1 FROM verse WHERE vkey = ?) "
            "AND NOT EXISTS (SELECT 1 FROM verse WHERE vkey > ? AND vkey < ?)",
            (end, start, end, start),
        )
    )


def _start_osis(a: int) -> str:
    b, c, v = key_to_parts(a)
    return f"{b}.{max(c, 1)}.{max(v, 1)}"


@router.get("/manuscripts")
def manuscripts(request: Request, collection: str | None = Query(None, max_length=60)) -> dict[str, Any]:
    """The catalogue (every manuscript, compact); the page filters, sorts and searches it in the browser."""
    s = store(request)
    where, params = ("WHERE m.collection = ?", (collection,)) if collection else ("", ())
    rows = s.all(
        f"SELECT {_COLUMNS}, substr(m.contents, 1, 160) AS contents, "
        "(SELECT value FROM external_id x WHERE x.entity_type = 'manuscript' AND x.entity_id = m.id "
        "AND x.scheme = 'wikipedia') AS wikipedia, "
        "(SELECT count(*) FROM manuscript_coverage c WHERE c.manuscript_id = m.id) AS passages "
        f"FROM manuscript m {where} ORDER BY {EARLIEST}",
        params,
    )
    counts = s.all("SELECT collection, count(*) AS n FROM manuscript GROUP BY collection ORDER BY collection")
    return {"manuscripts": rows, "collections": counts}


@router.get("/manuscript/{ms_id}")
def manuscript(request: Request, ms_id: str) -> dict[str, Any]:
    s = store(request)
    ms = s.one(
        "SELECT m.*, src.name AS source_name, src.attribution, src.license, src.url AS source_url "
        "FROM manuscript m LEFT JOIN source src ON src.id = m.source_id WHERE m.id = ?",
        (ms_id,),
    )
    if ms is None:
        raise HTTPException(404, f"unknown manuscript {ms_id!r}")
    ids: dict[str, list[str]] = {}
    for r in s.all(
        "SELECT scheme, value FROM external_id WHERE entity_type = 'manuscript' AND entity_id = ? ORDER BY scheme",
        (ms_id,),
    ):
        ids.setdefault(r["scheme"], []).append(r["value"])
    dating = s.all(
        "SELECT d.system_id, cs.name AS system, d.date_kind, d.start_year, d.end_year, d.circa, d.label, d.basis "
        "FROM dating d LEFT JOIN chronology_system cs ON cs.id = d.system_id "
        "WHERE d.entity_type = 'manuscript' AND d.entity_id = ? ORDER BY d.start_year",
        (ms_id,),
    )
    spans: list[list[Any]] = []
    for r in s.all(
        "SELECT start_vkey, end_vkey, completeness FROM manuscript_coverage WHERE manuscript_id = ? "
        "ORDER BY start_vkey",
        (ms_id,),
    ):
        if spans and _contiguous(s, spans[-1][1], r["start_vkey"]):  # 'Isaiah 1:1–31; 2:1–22' → 'Isaiah 1:1–2:22'
            spans[-1][1] = max(spans[-1][1], r["end_vkey"])
        else:
            spans.append([r["start_vkey"], r["end_vkey"], r["completeness"]])
    passages = [
        {
            "osis": _start_osis(a),
            "label": _span_label(a, b),
            "testament": "NT" if NT_FIRST <= a // 1_000_000 <= NT_LAST else "OT",
            "completeness": completeness,
        }
        for a, b, completeness in spans
    ]
    ga = next(iter(ids.get("ga", [])), None)
    return {
        "manuscript": ms,
        "ids": ids,
        "wikipedia": next(iter(ids.get("wikipedia", [])), None),
        "dating": dating,
        "passages": passages,
        "ntvmr": ntvmr_links(ga),
    }


@router.get("/verse/{osis}/manuscripts")
def verse_manuscripts(request: Request, osis: str, limit: int = Query(6, ge=1, le=50)) -> dict[str, Any]:
    """The earliest manuscripts containing a verse, and (Old Testament) the Dead Sea Scrolls that preserve it."""
    s = store(request)
    k = _verse_key(osis)
    base = (
        f"SELECT {_COLUMNS}, min(c.completeness) AS completeness, "
        "(SELECT value FROM external_id x WHERE x.entity_type = 'manuscript' AND x.entity_id = m.id "
        "AND x.scheme = 'ga') AS ga "
        "FROM manuscript_coverage c JOIN manuscript m ON m.id = c.manuscript_id "
        "WHERE c.start_vkey <= ? AND c.end_vkey >= ? AND m.collection {op} ? GROUP BY m.id "
    )
    order = f"ORDER BY {EARLIEST}"
    earliest = s.all(base.format(op="<>") + order + " LIMIT ?", (k, k, DSS, limit))
    nt = NT_FIRST <= k // 1_000_000 <= NT_LAST
    total = s.scalar(
        "SELECT count(DISTINCT c.manuscript_id) FROM manuscript_coverage c JOIN manuscript m "
        "ON m.id = c.manuscript_id WHERE c.start_vkey <= ? AND c.end_vkey >= ? AND m.collection <> ?",
        (k, k, DSS),
    )
    scrolls = s.all(base.format(op="=") + order + " LIMIT 60", (k, k, DSS))
    for m in earliest:
        ga = m.pop("ga")
        m["ntvmr"] = ntvmr_links(ga) if nt else None  # NTVMR images are of New Testament pages only
    for m in scrolls:
        m.pop("ga")
    return {
        "osis": _osis(k),
        "manuscripts": earliest,
        "total": total,
        "dss": scrolls,
        "ntvmr_verse": ntvmr_verse_url(k),
    }
