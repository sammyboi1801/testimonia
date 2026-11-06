"""Kings and rulers: realms with their reigns under each chronology system, who ruled when, and who ruled at the
time of a verse ("Under: Hezekiah of Judah · Sennacherib of Assyria").

Reigns are `office_holding` rows dated in `dating` (aspect 'reign', and 'coregency' / 'rival' for the years a
king shared the throne before reigning alone); realms are `period` rows with scope 'realm' (see ingest/rulers.py).
A reign is shown in the system the reader picked when it has a date there, else in its realm's default system.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from .api import _osis, _verse_key, store
from .store import Store

router = APIRouter(prefix="/api")

UNDER_LIMIT = 5  # rulers on a verse's "Under:" line
LONG_WINDOW = 100  # years: a verse dated this vaguely only lists the rulers its chapter names
KIND_RANK = {"local": 0, "overlord": 1, "named": 2}


@dataclass
class Realm:
    id: str
    name: str
    short: str
    office: str
    style: str
    kind: str
    sort: int
    systems: list[str]
    overlord: tuple[int, int] | None
    description: str | None
    citation: str | None

    def as_dict(self) -> dict[str, Any]:
        d = {k: v for k, v in self.__dict__.items() if k != "overlord"}
        d["overlord"] = list(self.overlord) if self.overlord else None
        return d


@dataclass
class Reign:
    id: str
    person_id: str
    name: str
    realm: str
    office: str
    seq: int
    dynasty: str | None
    scope: str | None
    note: str | None
    wikipedia: str | None = None
    verses: int = 0
    first_osis: str | None = None
    #: system id → {start, end, circa, label, basis, shared_from, shared_kind}
    dates: dict[str, dict[str, Any]] = field(default_factory=dict)

    def pick(self, prefer: list[str]) -> tuple[str, dict[str, Any]] | None:
        """(system, dates) in the first preferred system that dates this reign, else any curated one."""
        for sid in prefer:
            if sid in self.dates:
                return sid, self.dates[sid]
        for sid, d in self.dates.items():
            if sid != "wikidata":
                return sid, d
        return None


def _json(value: str | None) -> Any:
    try:
        return json.loads(value) if value else None
    except ValueError:
        return None


def load(s: Store) -> tuple[dict[str, Realm], list[Reign], dict[str, str]]:
    """Every realm and reign with all its dates, plus chronology system names."""
    attrs: dict[str, dict[str, Any]] = {}
    for r in s.all(
        "SELECT uri, key, value FROM entity_attr WHERE (uri LIKE 'period:realm-%' AND key LIKE 'realm.%') "
        "OR (uri LIKE 'office:%' AND key LIKE 'office.%')"
    ):
        attrs.setdefault(r["uri"], {})[r["key"].split(".", 1)[1]] = _json(r["value"])
    realms: dict[str, Realm] = {}
    for p in s.all("SELECT id, name, sort, description FROM period WHERE scope = 'realm' ORDER BY sort"):
        a = attrs.get(f"period:{p['id']}", {})
        overlord = a.get("overlord")
        rid = p["id"].removeprefix("realm-")
        realms[rid] = Realm(
            rid, p["name"], a.get("short") or p["name"], a.get("office") or "", a.get("style") or "of",
            a.get("kind") or "named", p["sort"] or 0, a.get("systems") or ["scholarly"],
            (overlord[0], overlord[1]) if overlord else None, p["description"], a.get("citation"),
        )  # fmt: skip
    wiki = {
        r["entity_id"]: r["value"]
        for r in s.all("SELECT entity_id, value FROM external_id WHERE entity_type = 'person' AND scheme = 'wikipedia'")
    }
    refs = {
        r["person_id"]: (r["n"], r["first"])
        for r in s.all(
            "SELECT person_id, count(*) AS n, min(vkey) AS first FROM person_ref "
            "WHERE person_id IN (SELECT person_id FROM office_holding) GROUP BY person_id"
        )
    }
    reigns: list[Reign] = []
    by_id: dict[str, Reign] = {}
    for h in s.all("SELECT id, person_id, office, seq, notes FROM office_holding ORDER BY seq"):
        a = attrs.get(f"office:{h['id']}", {})
        if a.get("realm") not in realms:
            continue  # other kinds of office (bishops…) are not rulers
        n, first = refs.get(h["person_id"], (0, None))
        g = Reign(
            h["id"], h["person_id"], a.get("name") or h["person_id"], a["realm"], h["office"], h["seq"] or 0,
            a.get("dynasty"), a.get("scope"), h["notes"], wiki.get(h["person_id"]), n,
            _osis(first) if first else None,
        )  # fmt: skip
        reigns.append(g)
        by_id[g.id] = g
    for d in s.all(
        "SELECT entity_id, aspect, system_id, start_year, end_year, circa, label, basis FROM dating "
        "WHERE entity_type = 'office_holding' ORDER BY aspect = 'reign' DESC"
    ):
        held = by_id.get(d["entity_id"])
        if held is None:
            continue
        if d["aspect"] == "reign":
            held.dates[d["system_id"]] = {
                "start": d["start_year"], "end": d["end_year"], "circa": bool(d["circa"]), "label": d["label"],
                "basis": d["basis"], "shared_from": None, "shared_kind": None,
            }  # fmt: skip
        elif d["system_id"] in held.dates:  # coregency / rival reign before the sole reign
            held.dates[d["system_id"]].update(shared_from=d["start_year"], shared_kind=d["aspect"])
    reigns.sort(key=lambda g: (realms[g.realm].sort, g.seq))
    names = {r["id"]: r["name"] for r in s.all("SELECT id, name FROM chronology_system")}
    return realms, reigns, names


def prefer(realm: Realm, system: str | None) -> list[str]:
    return ([system] if system else []) + realm.systems


def span(d: dict[str, Any]) -> tuple[int, int]:
    """First and last year of a reign, including a coregency or rival reign before it."""
    return (d["shared_from"] if d["shared_from"] is not None else d["start"]), d["end"]


def view(g: Reign, realm: Realm, system: str | None, names: dict[str, str]) -> dict[str, Any]:
    """A reign as the app shows it: the chosen system's dates plus all the others."""
    chosen = g.pick(prefer(realm, system))
    sid, d = chosen if chosen else (None, {})
    return {
        "id": g.id,
        "person_id": g.person_id,
        "name": g.name,
        "realm": g.realm,
        "office": g.office,
        "dynasty": g.dynasty,
        "scope": g.scope,
        "note": g.note,
        "wikipedia": g.wikipedia,
        "verses": g.verses,
        "first_osis": g.first_osis,
        "system": sid,
        "system_name": names.get(sid or "", sid),
        **{k: d.get(k) for k in ("start", "end", "circa", "label", "shared_from", "shared_kind")},
        "dates": g.dates,
    }


def ruling(reigns: list[Reign], realms: dict[str, Realm], year: int, system: str | None = None) -> list[Reign]:
    """Reigns that include `year` (astronomical) in the chosen system, coregencies included."""
    out = []
    for g in reigns:
        chosen = g.pick(prefer(realms[g.realm], system))
        if chosen:
            a, b = span(chosen[1])
            if a <= year <= b:
                out.append(g)
    return out


def realm_for(realms: dict[str, Realm], text: str) -> Realm | None:
    """A realm by id, name or short name ('judah', 'Assyria', 'Roman emperors', 'high priests')."""
    t = text.strip().lower()
    for r in realms.values():
        if t in (r.id, r.name.lower(), r.short.lower()):
            return r
    found = next((r for r in realms.values() if t and (t in r.name.lower() or t in r.id)), None)
    words = t.replace("-", " ").split()
    return found or next((r for r in realms.values() if words and all(w in r.name.lower() for w in words)), None)


# ----------------------------------------------------------------------------- endpoints


@router.get("/rulers")
def rulers(request: Request, system: str | None = Query(None, max_length=40)) -> dict[str, Any]:
    """Every realm with its reigns (dates in each chronology system) for the rulers page and timeline lane."""
    s = store(request)
    realms, reigns, names = load(s)
    used = sorted({sid for g in reigns for sid in g.dates})
    out = []
    for r in realms.values():
        rows = [view(g, r, system, names) for g in reigns if g.realm == r.id]
        if not rows:
            continue
        starts = [
            x["shared_from"] if x["shared_from"] is not None else x["start"] for x in rows if x["start"] is not None
        ]
        out.append({**r.as_dict(), "start": min(starts), "end": max(x["end"] for x in rows), "rulers": rows})
    out.sort(key=lambda r: r["sort"])
    systems = s.all(
        f"SELECT id, name, kind, description FROM chronology_system WHERE id IN ({','.join('?' * len(used))})", used
    )
    return {"systems": systems, "realms": out}


@router.get("/rulers/at")
def rulers_at(
    request: Request,
    year: int = Query(..., ge=-4000, le=2100, description="astronomical year (1 BC = 0, 701 BC = -700)"),
    realm: str | None = Query(None, max_length=60),
    system: str | None = Query(None, max_length=40),
) -> dict[str, Any]:
    s = store(request)
    realms, reigns, names = load(s)
    only = realm_for(realms, realm) if realm else None
    if realm and only is None:
        raise HTTPException(404, f"unknown realm {realm!r}")
    found = [g for g in ruling(reigns, realms, year, system) if only is None or g.realm == only.id]
    return {
        "year": year,
        "system": system,
        "rulers": [{**view(g, realms[g.realm], system, names), "realm_name": realms[g.realm].name} for g in found],
    }


@router.get("/rulers/person/{person_id}")
def person_reigns(request: Request, person_id: str) -> dict[str, Any]:
    """The reigns or offices one person held, with dates in every system (for the person page)."""
    s = store(request)
    realms, reigns, names = load(s)
    mine = [g for g in reigns if g.person_id == person_id]
    return {
        "person_id": person_id,
        "systems": names,
        "reigns": [
            {**view(g, realms[g.realm], None, names), "realm_name": realms[g.realm].name,
             "realm_short": realms[g.realm].short, "style": realms[g.realm].style}
            for g in mine
        ],
    }  # fmt: skip


@router.get("/verse/{osis}/rulers")
def verse_rulers(request: Request, osis: str, system: str | None = Query(None, max_length=40)) -> dict[str, Any]:
    """Who ruled at the time of a verse: its king(s), the empire over them, and any ruler its chapter names."""
    s = store(request)
    k = _verse_key(osis)
    return {"osis": osis, **under(s, k, system)}


def under(s: Store, k: int, system: str | None = None, limit: int = UNDER_LIMIT) -> dict[str, Any]:
    when = s.one(
        "SELECT start_year, end_year, label FROM verse_date WHERE vkey = ? AND start_year IS NOT NULL "
        "ORDER BY system_id = 'btb' DESC LIMIT 1",
        (k,),
    )
    if when is None:
        return {"window": None, "rulers": []}
    lo, hi = sorted((when["start_year"], when["end_year"] if when["end_year"] is not None else when["start_year"]))
    mid = (lo + hi) // 2
    realms, reigns, names = load(s)
    chapter = k - k % 1000
    refs = s.all("SELECT person_id, vkey FROM person_ref WHERE vkey BETWEEN ? AND ?", (chapter, chapter + 999))
    named = {r["person_id"] for r in refs}
    here = {r["person_id"] for r in refs if r["vkey"] == k}
    vague = hi - lo > LONG_WINDOW
    picked: list[tuple[int, int, Reign, bool]] = []
    for g in reigns:
        r = realms[g.realm]
        chosen = g.pick(prefer(r, system))
        if not chosen:
            continue
        a, b = span(chosen[1])
        is_named = g.person_id in named and a <= hi and b >= lo
        if vague and not is_named:
            continue
        covers = a <= mid <= b
        local = r.kind == "local" and g.scope != "named" and covers
        overlord = r.kind == "overlord" and covers and r.overlord is not None and r.overlord[0] <= mid <= r.overlord[1]
        if is_named or local or overlord:
            rank = (0 if g.person_id in here else 1) if is_named else 2
            picked.append((rank, KIND_RANK[r.kind] if g.scope != "named" else 2, g, is_named))
    # rulers the verse names come first, then those its chapter names; the rest fill the line up to the limit
    keep = sorted(picked, key=lambda p: (p[0], p[1], realms[p[2].realm].sort))[:limit]
    keep.sort(key=lambda p: (p[1], realms[p[2].realm].sort, p[2].seq))
    out = []
    for _, _, g, is_named in keep:
        r = realms[g.realm]
        v = view(g, r, system, names)
        coregent = v["shared_from"] is not None and v["start"] is not None and mid < v["start"]
        out.append({**{key: v[key] for key in ("id", "person_id", "name", "office", "realm", "system", "system_name",
                                                  "start", "end", "circa", "label", "shared_from", "shared_kind")},
                    "realm_name": r.name, "realm_short": r.short, "style": r.style, "named": is_named,
                    "coregent": coregent})  # fmt: skip
    return {"window": {"start": lo, "end": hi, "label": when["label"]}, "rulers": out}
