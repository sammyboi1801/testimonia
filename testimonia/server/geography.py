"""Places, people and events of the Bible: the atlas, their pages, and who/where a verse names."""

from __future__ import annotations

import json
import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..books import BOOKS, BY_OSIS
from .api import _osis, _verse_key, store
from .store import Store

router = APIRouter(prefix="/api")

PREVIEW_EDITIONS = ("bsb", "kjva", "web")
FAMILY = {  # relation → (label seen from person_a, label seen from person_b)
    "father_of": ("children", "parents"),
    "mother_of": ("children", "parents"),
    "spouse_of": ("spouses", "spouses"),
    "sibling_of": ("siblings", "siblings"),
    "half_sibling_of": ("half_siblings", "half_siblings"),
}


def _json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except ValueError:
        return None


def _attrs(s: Store, uri: str) -> dict[str, Any]:
    return {r["key"]: _json(r["value"]) for r in s.all("SELECT key, value FROM entity_attr WHERE uri = ?", (uri,))}


def _external(s: Store, etype: str, eid: str) -> dict[str, str]:
    rows = s.all(
        "SELECT scheme, value FROM external_id WHERE entity_type = ? AND entity_id = ? ORDER BY value", (etype, eid)
    )
    return {r["scheme"]: r["value"] for r in rows}


def _texts(s: Store, keys: list[int], preview: str) -> dict[int, str]:
    """Preview text of verses in the reader's translation (falling back to KJV/WEB)."""
    if not keys:
        return {}
    marks = ",".join("?" * len(keys))
    out: dict[int, str] = {}
    for ed in (preview, *PREVIEW_EDITIONS):
        missing = [k for k in keys if k not in out]
        if not missing:
            break
        marks = ",".join("?" * len(missing))
        for r in s.all(
            f"SELECT vkey, text FROM edition_verse WHERE edition_id = ? AND vkey IN ({marks})", (ed, *missing)
        ):
            out[r["vkey"]] = r["text"]
    return out


def _grouped(keys: list[int]) -> list[dict[str, Any]]:
    """Verse keys → [{book, name, testament, refs: ['3.16', …]}] in canonical order."""
    groups: dict[int, dict[str, Any]] = {}
    for k in sorted(keys):
        ord_, rest = divmod(k, 1_000_000)
        if not 0 < ord_ <= len(BOOKS):
            continue
        b = BOOKS[ord_ - 1]
        g = groups.setdefault(ord_, {"book": b.osis, "name": b.name, "testament": b.testament, "refs": []})
        g["refs"].append(f"{rest // 1000}.{rest % 1000}")
    return list(groups.values())


def _verses(s: Store, keys: list[int], preview: str, samples: int = 6) -> dict[str, Any]:
    """Grouped references plus the text of the first mention in the first few books."""
    groups = _grouped(keys)
    firsts = []
    for g in groups[:samples]:
        c, v = g["refs"][0].split(".")
        firsts.append(BY_OSIS[g["book"]].order * 1_000_000 + int(c) * 1000 + int(v))
    texts = _texts(s, firsts, preview)
    return {
        "count": len(keys),
        "books": groups,
        "samples": [{"osis": _osis(k), "text": texts.get(k)} for k in firsts],
    }


def _dating(s: Store, etype: str, eid: str) -> list[dict[str, Any]]:
    return s.all(
        "SELECT d.aspect, d.system_id, c.name AS system, d.date_kind, d.start_year, d.end_year, d.start_month, "
        "d.start_day, d.circa, d.label FROM dating d LEFT JOIN chronology_system c ON c.id = d.system_id "
        "WHERE d.entity_type = ? AND d.entity_id = ? ORDER BY d.aspect, d.system_id",
        (etype, eid),
    )


def _events(s: Store, ids: list[str]) -> list[dict[str, Any]]:
    """Event summaries (title, year, place) sorted by date."""
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    rows = s.all(
        "SELECT e.id, e.title, e.kind, e.place_id, p.name AS place, "
        "(SELECT start_year FROM dating d WHERE d.entity_type = 'event' AND d.entity_id = e.id AND d.aspect = 'when' "
        " ORDER BY d.system_id = 'jones' DESC LIMIT 1) AS year, "
        "(SELECT end_year FROM dating d WHERE d.entity_type = 'event' AND d.entity_id = e.id AND d.aspect = 'when' "
        " ORDER BY d.system_id = 'jones' DESC LIMIT 1) AS end_year, "
        "(SELECT min(start_vkey) FROM event_ref r WHERE r.event_id = e.id) AS first_vkey "
        f"FROM event e LEFT JOIN place p ON p.id = e.place_id WHERE e.id IN ({marks})",
        ids,
    )
    for r in rows:
        r["osis"] = _osis(r["first_vkey"]) if r["first_vkey"] else None
        del r["first_vkey"]
    return sorted(rows, key=lambda r: (r["year"] is None, r["year"] or 0, r["osis"] or ""))


def _people(s: Store, ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    rows = s.all(f"SELECT id, name, summary, kind, sex FROM person WHERE id IN ({marks})", ids)
    order = {pid: i for i, pid in enumerate(ids)}
    return sorted(rows, key=lambda r: order[r["id"]])


# ----------------------------------------------------------------------------- atlas


@router.get("/atlas")
def atlas(request: Request) -> dict[str, Any]:
    """Every located place, with its confidence and the books that name it (the atlas filters on the client)."""
    s = store(request)
    conf = {
        r["uri"][6:]: r["confidence"]
        for r in s.all("SELECT uri, confidence FROM entity_attr WHERE key = 'geo.confidence' AND uri LIKE 'place:%'")
    }
    books = {
        r["place_id"]: [int(b) for b in r["books"].split(",")]
        for r in s.all(
            "SELECT place_id, group_concat(DISTINCT vkey / 1000000) AS books FROM place_ref GROUP BY place_id"
        )
    }
    counts = {r["place_id"]: r["n"] for r in s.all("SELECT place_id, count(*) AS n FROM place_ref GROUP BY place_id")}
    places = s.all(
        "SELECT id, name, kind, lat, lon, precision, modern_name FROM place WHERE lat IS NOT NULL ORDER BY id"
    )
    for p in places:
        p["confidence"] = conf.get(p["id"])
        p["verses"] = counts.get(p["id"], 0)
        p["books"] = sorted(books.get(p["id"], []))
    routes = s.all("SELECT id, kind, name, date_from, date_to, source_id FROM geo_feature ORDER BY id")
    return {"places": places, "routes": routes}


@router.get("/atlas/routes")
def atlas_routes(request: Request) -> list[dict[str, Any]]:
    """Route and road geometries (GeoJSON features), e.g. Paul's journeys."""
    s = store(request)
    rows = s.all("SELECT id, kind, name, geojson, source_id FROM geo_feature ORDER BY id")
    for r in rows:
        r["geojson"] = _json(r["geojson"])
    return rows


# ----------------------------------------------------------------------------- places


@router.get("/place/{place_id}")
def place(request: Request, place_id: str, preview: str = "bsb") -> dict[str, Any]:
    s = store(request)
    p = s.one(
        "SELECT p.id, p.name, p.alt_names, p.kind, p.lat, p.lon, p.precision, p.modern_name, p.summary, p.source_id, "
        "src.name AS source_name FROM place p LEFT JOIN source src ON src.id = p.source_id WHERE p.id = ?",
        (place_id,),
    )
    if p is None:
        raise HTTPException(404, f"unknown place {place_id!r}")
    p["alt_names"] = _json(p["alt_names"]) or []
    uri = f"place:{place_id}"
    attrs = _attrs(s, uri)
    p["confidence"] = attrs.get("geo.confidence")
    p["easton"] = attrs.get("dict.easton")
    p["external"] = _external(s, "place", place_id)
    keys = [r["vkey"] for r in s.all("SELECT vkey FROM place_ref WHERE place_id = ? ORDER BY vkey", (place_id,))]
    links = s.all("SELECT src, rel FROM entity_link WHERE dst = ? AND review = 'accepted'", (uri,))
    event_ids = list(
        dict.fromkeys(
            [r["src"][6:] for r in links if r["src"].startswith("event:")]
            + [r["id"] for r in s.all("SELECT id FROM event WHERE place_id = ?", (place_id,))]
        )
    )
    events = _events(s, event_ids)
    roles: dict[str, list[str]] = {}
    for r in links:
        if r["src"].startswith("person:"):
            roles.setdefault(r["src"][7:], []).append(r["rel"])
    if event_ids:  # people taking part in events here, most involved first
        marks = ",".join("?" * len(event_ids))
        for r in s.all(
            f"SELECT person_id, count(*) AS n FROM event_participant WHERE event_id IN ({marks}) "
            "GROUP BY person_id ORDER BY n DESC LIMIT 24",
            event_ids,
        ):
            roles.setdefault(r["person_id"], []).append("event")
    people = _people(s, list(roles))
    for person in people:
        person["roles"] = sorted(set(roles[person["id"]]))
    return {
        "place": p,
        "verses": _verses(s, keys, preview),
        "events": events,
        "people": people,
        "nearby": _nearby(s, p),
        "routes": [
            r["id"]
            for r in s.all("SELECT id, geojson FROM geo_feature WHERE geojson LIKE ?", (f'%"place":"{place_id}"%',))
        ],
    }


def _nearby(s: Store, p: dict[str, Any], limit: int = 12, same_site: int = 30) -> list[dict[str, Any]]:
    """Places at the same site (under 1 km: Jerusalem's gates) and the nearest others, each list capped on its own.

    Regions are left out: their point is only a representative one."""
    if p["lat"] is None:
        return []
    lat, lon = p["lat"], p["lon"]
    d = 0.6
    rows = s.all(
        "SELECT id, name, kind, lat, lon FROM place WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND id <> ? "
        "AND kind IS NOT 'region'",
        (lat - d, lat + d, lon - d, lon + d, p["id"]),
    )
    for r in rows:
        dy, dx = (r["lat"] - lat) * 111.2, (r["lon"] - lon) * 111.2 * math.cos(math.radians(lat))
        r["km"] = round(math.hypot(dx, dy), 1)
    rows.sort(key=lambda r: (r["km"], r["name"]))
    return [r for r in rows if r["km"] < 1][:same_site] + [r for r in rows if r["km"] >= 1][:limit]


# ----------------------------------------------------------------------------- people


@router.get("/person/{person_id}")
def person(request: Request, person_id: str, preview: str = "bsb") -> dict[str, Any]:
    s = store(request)
    p = s.one(
        "SELECT p.id, p.name, p.alt_names, p.sex, p.kind, p.born, p.died, p.floruit_from, p.floruit_to, p.era, "
        "p.summary, p.bio, p.source_id, src.name AS source_name FROM person p "
        "LEFT JOIN source src ON src.id = p.source_id WHERE p.id = ?",
        (person_id,),
    )
    if p is None:
        raise HTTPException(404, f"unknown person {person_id!r}")
    p["alt_names"] = _json(p["alt_names"]) or []
    uri = f"person:{person_id}"
    attrs = _attrs(s, uri)
    p["groups"] = attrs.get("bio.groups") or []
    p["wrote"] = [{"osis": b, "name": BY_OSIS[b].name} for b in attrs.get("bio.wrote") or [] if b in BY_OSIS]
    p["external"] = _external(s, "person", person_id)
    p["dating"] = _dating(s, "person", person_id)

    family: dict[str, list[str]] = {k: [] for k in ("parents", "spouses", "siblings", "half_siblings", "children")}
    for r in s.all(
        "SELECT person_a, relation, person_b FROM person_relation WHERE person_a = ? OR person_b = ?",
        (person_id, person_id),
    ):
        if r["relation"] not in FAMILY:
            continue
        mine = r["person_a"] == person_id
        label = FAMILY[r["relation"]][0 if mine else 1]
        other = r["person_b"] if mine else r["person_a"]
        if other not in family[label]:
            family[label].append(other)
    fam = {k: _people(s, v) for k, v in family.items() if v}

    event_ids = [
        r["event_id"] for r in s.all("SELECT event_id FROM event_participant WHERE person_id = ?", (person_id,))
    ]
    events = _events(s, event_ids)
    roles: dict[str, list[str]] = {}
    for r in s.all("SELECT rel, dst FROM entity_link WHERE src = ? AND dst LIKE 'place:%'", (uri,)):
        roles.setdefault(r["dst"][6:], []).append(r["rel"])
    for e in events:
        if e["place_id"]:
            roles.setdefault(e["place_id"], []).append("event")
    places = []
    if roles:
        marks = ",".join("?" * len(roles))
        places = s.all(f"SELECT id, name, kind, lat, lon FROM place WHERE id IN ({marks})", list(roles))
        for pl in places:
            pl["roles"] = sorted(set(roles[pl["id"]]))
        places.sort(key=lambda pl: (-("born_at" in pl["roles"]), -len(roles[pl["id"]]), pl["name"]))
    keys = [r["vkey"] for r in s.all("SELECT vkey FROM person_ref WHERE person_id = ? ORDER BY vkey", (person_id,))]
    return {
        "person": p,
        "family": fam,
        "events": events,
        "places": places,
        "verses": _verses(s, keys, preview),
    }


# ----------------------------------------------------------------------------- events


@router.get("/event/{event_id}")
def event(request: Request, event_id: str, preview: str = "bsb") -> dict[str, Any]:
    s = store(request)
    e = s.one(
        "SELECT e.id, e.title, e.kind, e.description, e.place_id, e.source_id, src.name AS source_name FROM event e "
        "LEFT JOIN source src ON src.id = e.source_id WHERE e.id = ?",
        (event_id,),
    )
    if e is None:
        raise HTTPException(404, f"unknown event {event_id!r}")
    uri = f"event:{event_id}"
    e["external"] = _external(s, "event", event_id)
    e["dating"] = _dating(s, "event", event_id)
    people = s.all(
        "SELECT p.id, p.name, p.summary, p.kind, p.sex, ep.role FROM event_participant ep "
        "JOIN person p ON p.id = ep.person_id WHERE ep.event_id = ?",
        (event_id,),
    )
    people.sort(key=lambda p: (p["id"] in ("god", "holy-spirit"), p["name"]))
    place_ids = list(
        dict.fromkeys(
            ([e["place_id"]] if e["place_id"] else [])
            + [r["dst"][6:] for r in s.all("SELECT dst FROM entity_link WHERE src = ? AND rel = 'located_at'", (uri,))]
        )
    )
    places = []
    if place_ids:
        marks = ",".join("?" * len(place_ids))
        places = s.all(f"SELECT id, name, kind, lat, lon FROM place WHERE id IN ({marks})", place_ids)
    refs = s.all("SELECT start_vkey, end_vkey FROM event_ref WHERE event_id = ? ORDER BY start_vkey", (event_id,))
    passage: list[int] = []
    for r in refs:
        r["osis"], r["end_osis"] = _osis(r["start_vkey"]), _osis(r["end_vkey"])
        for k in range(r["start_vkey"], r["end_vkey"] + 1):
            if len(passage) < 24:
                passage.append(k)
    texts = _texts(s, passage, preview)
    related: dict[str, list[str]] = {"part_of": [], "parts": [], "after": [], "before": []}
    for r in s.all(
        "SELECT src, rel, dst FROM entity_link WHERE (src = ? OR dst = ?) AND rel IN ('part_of', 'follows')", (uri, uri)
    ):
        if r["src"] == uri and r["dst"].startswith("event:"):
            related["part_of" if r["rel"] == "part_of" else "after"].append(r["dst"][6:])
        elif r["dst"] == uri and r["src"].startswith("event:"):
            related["parts" if r["rel"] == "part_of" else "before"].append(r["src"][6:])
    return {
        "event": e,
        "people": people,
        "places": places,
        "refs": refs,
        "passage": [{"osis": _osis(k), "text": texts[k]} for k in passage if k in texts],
        "related": {k: _events(s, v) for k, v in related.items() if v},
    }


# ----------------------------------------------------------------------------- per verse


@router.get("/chapter/{book}/{chapter}/places")
def chapter_places(request: Request, book: str, chapter: int) -> dict[str, Any]:
    """The places named in each verse of a chapter (for marking place names in the reader), with their names."""
    s = store(request)
    lo = _verse_key(f"{book}.{chapter}.1") - 1  # verse 0 holds Psalm titles
    rows = s.all(
        "SELECT r.vkey, p.id, p.name, p.alt_names, p.kind, p.modern_name, p.lat, p.lon, "
        "(SELECT count(*) FROM place_ref x WHERE x.place_id = p.id) AS verses "
        "FROM place_ref r JOIN place p ON p.id = r.place_id WHERE r.vkey BETWEEN ? AND ? AND p.kind <> 'region'",
        (lo, lo + 999),
    )
    by_verse: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        k = r.pop("vkey")
        by_verse.setdefault(k, []).append(r)
    return {"verses": by_verse}


MAX_FOCUS = 400


@router.get("/places/in")
def places_in(
    request: Request,
    ref: str | None = Query(None, max_length=200),
    person: str | None = Query(None, max_length=120),
    event: str | None = Query(None, max_length=120),
) -> dict[str, Any]:
    """The mapped places of a passage ('2 Kings 1', 'Acts 13-14', 'Ruth'), a person's verses or an event's
    narrative, in the order the text first names them: what the map panel and the assistant show."""
    s = store(request)
    spans: list[tuple[int, int]] = []
    title = ""
    if ref:
        from ..refs import parse_refs

        found = parse_refs(ref)
        if not found:
            book = _book_by_name(ref)
            if book:
                spans.append((_verse_key(f"{book}.1.1") - 1, _verse_key(f"{book}.{BY_OSIS[book].chapters}.1") + 999))
                title = BY_OSIS[book].name
        for rng in found:
            spans.append((rng.start, rng.end))
            title = title or rng.label()
    elif person:
        row = s.one("SELECT name FROM person WHERE id = ?", (person,))
        if not row:
            raise HTTPException(404, f"unknown person {person}")
        title = row["name"]
        spans = [(r["vkey"], r["vkey"]) for r in s.all("SELECT vkey FROM person_ref WHERE person_id = ?", (person,))]
    elif event:
        row = s.one("SELECT title FROM event WHERE id = ?", (event,))
        if not row:
            raise HTTPException(404, f"unknown event {event}")
        title = row["title"]
        spans = [
            (r["start_vkey"], r["end_vkey"])
            for r in s.all("SELECT start_vkey, end_vkey FROM event_ref WHERE event_id = ?", (event,))
        ]
    if not spans:
        raise HTTPException(404, "give a passage, a person or an event")
    where = " OR ".join("r.vkey BETWEEN ? AND ?" for _ in spans)
    rows = s.all(
        "SELECT p.id, p.name, p.kind, p.lat, p.lon, p.modern_name, min(r.vkey) AS first, count(*) AS n "
        f"FROM place_ref r JOIN place p ON p.id = r.place_id WHERE ({where}) AND p.lat IS NOT NULL "
        "GROUP BY p.id ORDER BY first LIMIT ?",
        (*[k for span in spans for k in span], MAX_FOCUS),
    )
    for row in rows:
        row["first_osis"] = _osis(row.pop("first"))
    return {"title": title, "places": rows}


def _book_by_name(name: str) -> str | None:
    from ..books import resolve_book

    return resolve_book(name.strip())


@router.get("/verse/{osis}/entities")
def verse_entities(request: Request, osis: str, limit: int = Query(40, ge=1, le=200)) -> dict[str, Any]:
    """People and places a verse names, and the events whose narrative includes it."""
    s = store(request)
    k = _verse_key(osis)
    people = s.all(
        "SELECT p.id, p.name, p.summary, (SELECT count(*) FROM person_ref x WHERE x.person_id = p.id) AS verses "
        "FROM person_ref r JOIN person p ON p.id = r.person_id WHERE r.vkey = ? ORDER BY verses DESC LIMIT ?",
        (k, limit),
    )
    places = s.all(
        "SELECT p.id, p.name, p.kind, p.lat, p.lon, p.modern_name FROM place_ref r JOIN place p ON p.id = r.place_id "
        "WHERE r.vkey = ? ORDER BY p.name LIMIT ?",
        (k, limit),
    )
    events = s.all(
        "SELECT e.id, e.title FROM event_ref r JOIN event e ON e.id = r.event_id "
        "WHERE r.start_vkey <= ? AND r.end_vkey >= ? AND r.start_vkey >= ? ORDER BY r.end_vkey - r.start_vkey LIMIT 6",
        (k, k, k - 1_000_000),
    )
    return {"osis": osis, "people": people, "places": places, "events": events}
