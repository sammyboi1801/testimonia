"""Deeper word study: semantic domains, senses, related words and Septuagint equivalents (MACULA data).

Senses are the ``lemma_sense`` rows of a lemma (Greek: Louw–Nida entries; Hebrew: SDBH lexical domains);
how often each is used is counted from ``token.domain_id``. A *field* is the domain a sense belongs to
(Greek: the SDBG subdomain above the Louw–Nida entry; Hebrew: the SDBH domain itself); the other words
with a sense in the same field are its related words. Septuagint equivalents are ``entity_link`` rows
``lemma:H… —lxx_equivalent→ lemma:G…`` weighted by the number of places.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..ingest.macula import LXX_REL
from ..refs import key_to_parts
from .store import Store

router = APIRouter(prefix="/api")

STRONG = re.compile(r"^[GH]\d{4}[A-Za-z]?$")
DOMAIN = re.compile(r"^(LN|SDBG|SDBH):[0-9.a-z]{1,20}$")
SYSTEM_NAME = {"louw-nida": "Louw–Nida", "sdbg": "Semantic Dictionary of Biblical Greek", "sdbh": "SDBH"}
CREDIT = {
    "grc": "Domains: Louw & Nida and the UBS Semantic Dictionary of Biblical Greek (CC BY-SA 4.0), "
    "via MACULA Greek (CC BY 4.0)",
    "hbo": "Domains: UBS Semantic Dictionary of Biblical Hebrew (CC BY-SA 4.0); "
    "Septuagint equivalents: MACULA Hebrew (CC BY 4.0)",
}


def store(request: Request) -> Store:
    s: Store = request.app.state.store
    return s


def _words(s: Store, ids: list[str]) -> dict[str, dict[str, Any]]:
    """Lemma rows (lemma, translit, gloss) plus total occurrences, for a list of lemma ids."""
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    out = {
        r["id"]: {**r, "n": 0, "first": None}
        for r in s.all(f"SELECT id, lemma, translit, gloss, language FROM lemma WHERE id IN ({marks})", ids)
    }
    for r in s.all(
        f"SELECT lemma_id, count(*) AS n, min(vkey) AS first FROM token WHERE lemma_id IN ({marks}) GROUP BY lemma_id",
        ids,
    ):
        if r["lemma_id"] in out:
            b, c, v = key_to_parts(r["first"])
            out[r["lemma_id"]] |= {"n": r["n"], "first": f"{b}.{c}.{v}"}
    return out


def _sense_counts(s: Store, strong: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for r in s.all(
        "SELECT domain_id, count(*) AS n FROM token WHERE lemma_id = ? AND domain_id IS NOT NULL GROUP BY domain_id",
        (strong,),
    ):
        for d in r["domain_id"].split():
            counts[d] += r["n"]
    return counts


def _field_members(s: Store, field: str, greek: bool) -> list[dict[str, Any]]:
    """(lemma_id, domain_id) of every sense in a field."""
    if greek:
        return s.all(
            "SELECT ls.lemma_id, ls.domain_id FROM lemma_sense ls JOIN semantic_domain sd ON sd.id = ls.domain_id "
            "WHERE sd.parent_id = ?",
            (field,),
        )
    return s.all("SELECT lemma_id, domain_id FROM lemma_sense WHERE domain_id = ?", (field,))


def _field_counts(s: Store, lemma_ids: list[str], entries: set[str]) -> Counter[str]:
    """How often each lemma is used in a field: its tokens whose sense in context is one of ``entries``."""
    out: Counter[str] = Counter()
    if not lemma_ids:
        return out
    marks = ",".join("?" * len(lemma_ids))
    for r in s.all(
        f"SELECT lemma_id, domain_id, count(*) AS n FROM token WHERE lemma_id IN ({marks}) AND domain_id IS NOT NULL "
        "GROUP BY lemma_id, domain_id",
        lemma_ids,
    ):
        if any(d in entries for d in r["domain_id"].split()):
            out[r["lemma_id"]] += r["n"]
    return out


def _group_by_strong(rows: list[dict[str, Any]], sums: tuple[str, ...] = ("n",)) -> list[dict[str, Any]]:
    """Merge STEPBible's sense-split lemmas (H1697G 'word', H1697I 'word: thing'…) under the first one,
    keeping the order of ``rows`` and adding up the ``sums`` fields; ``ids`` lists the merged lemma ids."""
    grouped: dict[str, dict[str, Any]] = {}
    for r in rows:
        g = grouped.get(r["id"][:5])
        if g is None:
            grouped[r["id"][:5]] = {**r, "ids": [r["id"]]}
            continue
        for k in sums:
            g[k] += r[k]
        g["ids"].append(r["id"])
    return list(grouped.values())


def _code(domain_id: str) -> str:
    return domain_id.split(":", 1)[1]


@router.get("/word/{strong}/domains")
def word_domains(
    request: Request,
    strong: str,
    related: int = Query(12, ge=0, le=500),
    fields: int = Query(4, ge=1, le=20),
) -> dict[str, Any]:
    """Senses (with counts), semantic fields with related words, and Septuagint equivalents of a word."""
    if not STRONG.match(strong):
        raise HTTPException(400, "expected an extended Strong's number such as G3439 or H0430G")
    s = store(request)
    greek = strong.startswith("G")
    counts = _sense_counts(s, strong)
    rows = s.all(
        "SELECT ls.n, ls.domain_id, ls.gloss, sd.label, sd.parent_id, sd.description, sd.system "
        "FROM lemma_sense ls LEFT JOIN semantic_domain sd ON sd.id = ls.domain_id "
        "WHERE ls.lemma_id = ? AND ls.domain_id IS NOT NULL ORDER BY ls.n",
        (strong,),
    )
    senses = [
        {
            "id": r["domain_id"],
            "code": _code(r["domain_id"]),
            "gloss": r["gloss"] or r["label"],
            "label": r["label"],
            "field": (r["parent_id"] if greek else r["domain_id"]) or r["domain_id"],
            "n": counts.get(r["domain_id"], 0),
        }
        for r in rows
    ]
    senses.sort(key=lambda x: -x["n"])

    by_field: Counter[str] = Counter()
    for x in senses:
        by_field[x["field"]] += x["n"] or 1  # senses without counted tokens still make a field
    field_rows = []
    for field_id, n in by_field.most_common(fields):
        dom = s.one("SELECT id, parent_id, system, label, description FROM semantic_domain WHERE id = ?", (field_id,))
        if dom is None:
            continue
        mine = {x["id"] for x in senses if x["field"] == field_id}
        members = _field_members(s, field_id, greek)
        same = {m["lemma_id"] for m in members if m["domain_id"] in mine}
        others = sorted({m["lemma_id"] for m in members if m["lemma_id"] != strong})
        info = _words(s, others)
        in_field = _field_counts(s, others, {m["domain_id"] for m in members})
        for w in info.values():
            w["n_field"] = in_field.get(w["id"], 0)
        # words sharing one of this word's senses first, then by how often they are used in this field
        words = _group_by_strong(
            sorted(info.values(), key=lambda w: (w["id"] not in same, -w["n_field"], -w["n"], w["lemma"] or "")),
            ("n", "n_field"),
        )
        field_rows.append(
            {
                **dom,
                "system_name": SYSTEM_NAME.get(dom["system"], dom["system"]),
                "n": n,
                "senses": [x["id"] for x in senses if x["field"] == field_id],
                "total_words": len(words),
                "words": [{**w, "same_sense": bool(same.intersection(w["ids"]))} for w in words[:related]],
            }
        )

    if greek:
        links = s.all(
            "SELECT substr(src, 7) AS id, weight FROM entity_link WHERE dst = ? AND rel = ? ORDER BY weight DESC",
            (f"lemma:{strong}", LXX_REL),
        )
    else:
        links = s.all(
            "SELECT substr(dst, 7) AS id, weight FROM entity_link WHERE src = ? AND rel = ? ORDER BY weight DESC",
            (f"lemma:{strong}", LXX_REL),
        )
    info = _words(s, [r["id"] for r in links])
    lxx = _group_by_strong(
        sorted(
            [
                {
                    "id": r["id"],
                    "lemma": info.get(r["id"], {}).get("lemma"),
                    "translit": info.get(r["id"], {}).get("translit"),
                    "gloss": info.get(r["id"], {}).get("gloss"),
                    "n": int(r["weight"] or 0),
                }
                for r in links
            ],
            key=lambda x: -x["n"],
        )
    )
    lxx.sort(key=lambda x: -x["n"])
    return {
        "strong": strong,
        "language": "grc" if greek else "hbo",
        "senses": senses,
        "fields": field_rows,
        "lxx": {
            "direction": "hebrew" if greek else "greek",
            "total": sum(x["n"] for x in lxx),
            "words": lxx,
        },
        "credit": CREDIT["grc" if greek else "hbo"] if senses or lxx else None,
    }


@router.get("/domains/{domain_id}")
def domain(request: Request, domain_id: str) -> dict[str, Any]:
    """A semantic domain: its ancestors, subdomains and every word with a sense in it (or beneath it)."""
    if not DOMAIN.match(domain_id):
        raise HTTPException(400, "expected a domain id such as SDBG:033006, LN:33 or SDBH:001001001")
    s = store(request)
    dom = s.one("SELECT id, parent_id, system, label, description FROM semantic_domain WHERE id = ?", (domain_id,))
    if dom is None:
        raise HTTPException(404, f"unknown semantic domain {domain_id}")
    path: list[dict[str, Any]] = []
    parent = dom["parent_id"]
    while parent and len(path) < 10:
        p = s.one("SELECT id, parent_id, label FROM semantic_domain WHERE id = ?", (parent,))
        if p is None:
            break
        path.insert(0, {"id": p["id"], "label": p["label"]})
        parent = p["parent_id"]
    children = s.all(
        "SELECT id, label FROM semantic_domain WHERE parent_id = ? AND system <> 'louw-nida' ORDER BY id",
        (domain_id,),
    )
    greek = dom["system"] == "sdbg"
    members = _field_members(s, domain_id, greek)
    senses: dict[str, set[str]] = {}
    for m in members:
        senses.setdefault(m["lemma_id"], set()).add(m["domain_id"])
    info = _words(s, sorted(senses))
    in_domain = _field_counts(s, sorted(senses), {m["domain_id"] for m in members})
    for w in info.values():
        w["n_field"] = in_domain.get(w["id"], 0)
    words = _group_by_strong(
        sorted(info.values(), key=lambda w: (-w["n_field"], -w["n"], w["lemma"] or "")), ("n", "n_field")
    )
    entries = {}
    if greek:
        entries = {
            r["id"]: r["label"]
            for r in s.all("SELECT id, label FROM semantic_domain WHERE parent_id = ?", (domain_id,))
        }
    return {
        **dom,
        "system_name": SYSTEM_NAME.get(dom["system"], dom["system"]),
        "path": path,
        "children": children,
        "words": [
            {
                **w,
                "senses": [
                    {"id": d, "code": _code(d), "gloss": entries.get(d)}
                    for d in sorted(set().union(*(senses[i] for i in w["ids"])))
                ],
            }
            for w in words
        ],
    }
