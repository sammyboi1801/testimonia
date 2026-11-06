"""Biblical places from the OpenBible.info Bible Geocoding Data (CC BY 4.0).

Each ancient place in ``data/ancient.jsonl`` lists the verses that name it and one or more proposed
*identifications* (modern sites, other ancient places, or "unknown"), each scored by how widely scholars
accept it. We keep the best-scored identification's point as the place's coordinates and its score as the
confidence, so the atlas can show doubtful sites as doubtful. Pleiades, Wikidata and Wikipedia ids are
kept as external ids. No OpenStreetMap geometry is used (that part of the dataset is ODbL).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from ..refs import id_to_key
from .base import Context, IngestError, step

SOURCE = "openbible-geo"

#: OpenBible place types → our coarse `place.kind` (first match in the place's type list wins).
KINDS: dict[str, str] = {
    "settlement": "city",
    "district in settlement": "city",
    "region": "region",
    "people group": "region",
    "island": "island",
    "mountain": "mountain",
    "mountain range": "mountain",
    "mountain ridge": "mountain",
    "mountain pass": "mountain",
    "hill": "mountain",
    "cliff": "mountain",
    "promontory": "mountain",
    "rock": "mountain",
    "river": "river",
    "wadi": "river",
    "canal": "river",
    "ford": "river",
    "body of water": "water",
    "spring": "water",
    "well": "water",
    "pool": "water",
    "valley": "valley",
    "natural area": "valley",
    "field": "valley",
    "forest": "valley",
    "garden": "valley",
    "campsite": "camp",
}
EXACT = {"point", "settlement"}  # lonlat_type values that mark a specific spot (vs. a centre or representative point)
_TAG = re.compile(r"<[^>]+>")
_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """'Abel-beth-maacah' → 'abel-beth-maacah'; 'Antioch 1' → 'antioch-1'; "Jacob's Well" → 'jacobs-well'."""
    return _SLUG.sub("-", text.lower().replace("'", "").replace("’", "")).strip("-")


def plain(html: str) -> str:
    return " ".join(_TAG.sub("", html).split())


@dataclass
class Place:
    id: str
    ob_id: str
    name: str
    kind: str
    lat: float | None
    lon: float | None
    precision: str
    confidence: float | None
    modern_name: str | None
    summary: str | None
    alt_names: list[str]
    vkeys: list[int]
    external: list[tuple[str, str]] = field(default_factory=list)


def _score(ident: dict[str, Any]) -> int:
    s = ident.get("score") or {}
    v = s.get("time_total", s.get("vote_total", 0))
    return int(v) if isinstance(v, int | float) else 0


def _point(ident: dict[str, Any]) -> tuple[float, float, str] | None:
    """(lat, lon, lonlat_type) of an identification's best resolution that has coordinates."""
    best: tuple[int, float, float, str] | None = None
    for res in ident.get("resolutions") or []:
        ll = res.get("lonlat")
        if not isinstance(ll, str) or "," not in ll:
            continue
        try:
            lon, lat = (float(x) for x in ll.split(",", 1))
        except ValueError:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        rank = int(res.get("best_path_score") or 0)
        if best is None or rank > best[0]:
            best = (rank, lat, lon, str(res.get("lonlat_type") or ""))
    return None if best is None else best[1:]


def _external(linked: dict[str, Any]) -> Iterator[tuple[str, str]]:
    """Pleiades / Wikidata / Wikipedia ids, recognised by their values (the dataset keys sources by opaque ids)."""
    for entry in linked.values():
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or "")
        ident = str(entry.get("id") or "")
        if "pleiades.stoa.org/places/" in url and ident.isdigit():
            yield "pleiades", ident
        elif re.fullmatch(r"Q\d+", ident):
            yield "wikidata", ident
        elif "en.wikipedia.org/wiki/" in url and entry.get("modifier") in (None, "", "redirect", "main"):
            # not "partial" / "anchor" / "nonunique_url": those articles are about more than this place
            yield "wikipedia", unquote(url.split("/wiki/", 1)[1]).replace("_", " ")


def parse_place(rec: dict[str, Any]) -> Place | None:
    """One ancient.jsonl record → Place (None for records that name no verse)."""
    vkeys = sorted({k for v in rec.get("verses") or [] if (k := id_to_key(str(v.get("osis", "")))) is not None})
    if not vkeys:
        return None
    friendly = str(rec["friendly_id"])
    name = re.sub(r"\s+\d+$", "", friendly)
    types = [str(t) for t in rec.get("types") or []]
    kind = next((KINDS[t] for t in types if t in KINDS), "site" if types and types[0] != "special" else "other")
    idents = sorted(rec.get("identifications") or [], key=_score, reverse=True)
    lat = lon = None
    precision, confidence = "unknown", None
    if idents:
        confidence = max(0.0, min(1.0, _score(idents[0]) / 1000))
    for ident in idents:  # best-scored identification that can be placed on a map
        pt = _point(ident)
        if pt:
            lat, lon = round(pt[0], 6), round(pt[1], 6)
            precision = "exact" if pt[2] in EXACT else "approximate"
            confidence = max(0.0, min(1.0, _score(ident) / 1000))
            break
    modern = sorted((rec.get("modern_associations") or {}).values(), key=lambda m: -int(m.get("score") or 0))
    modern_name = str(modern[0]["name"]) if modern and modern[0].get("name") else None
    names = [str(n) for n in (rec.get("translation_name_counts") or {})]
    alt = [n for n in dict.fromkeys(names) if n != name]
    comment = plain(str(rec.get("comment") or ""))
    if " " not in comment:  # a bare type word ('region', 'river') is not a description
        comment = ""
    return Place(
        id=slugify(friendly),
        ob_id=str(rec["id"]),
        name=name,
        kind=kind,
        lat=lat,
        lon=lon,
        precision=precision,
        confidence=confidence,
        modern_name=modern_name if modern_name != name else None,
        summary=comment or None,
        alt_names=alt,
        vkeys=vkeys,
        external=sorted(set(_external(rec.get("linked_data") or {}))),
    )


def read_places(path: Path) -> Iterator[Place]:
    with path.open(encoding="utf-8") as fh:
        for n, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                raise IngestError(f"{path.name}:{n}: not JSON ({exc})") from exc
            if not isinstance(rec, dict) or "friendly_id" not in rec or "id" not in rec:
                raise IngestError(f"{path.name}:{n}: not an ancient-place record")
            p = parse_place(rec)
            if p:
                yield p


def write_places(ctx: Context, places: Iterable[Place], source: str) -> int:
    """Insert places with their verse references, confidence and external ids; returns the number written."""
    con = ctx.con
    n = 0
    for p in places:
        con.execute(
            "INSERT INTO place (id, name, alt_names, kind, lat, lon, precision, modern_name, summary, source_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                p.id,
                p.name,
                json.dumps(p.alt_names, ensure_ascii=False) if p.alt_names else None,
                p.kind,
                p.lat,
                p.lon,
                p.precision,
                p.modern_name,
                p.summary,
                source,
            ),
        )
        con.executemany("INSERT OR IGNORE INTO place_ref (place_id, vkey) VALUES (?, ?)", ((p.id, k) for k in p.vkeys))
        if p.confidence is not None:
            con.execute(
                "INSERT INTO entity_attr (uri, key, value, confidence, source_id) "
                "VALUES (?, 'geo.confidence', ?, ?, ?)",
                (f"place:{p.id}", json.dumps(round(p.confidence, 3)), round(p.confidence, 3), source),
            )
        ext = [("openbible", p.ob_id), *p.external] if source == SOURCE else p.external
        con.executemany(
            "INSERT OR IGNORE INTO external_id (entity_type, entity_id, scheme, value) VALUES ('place', ?, ?, ?)",
            ((p.id, scheme, value) for scheme, value in ext),
        )
        n += 1
    return n


@step("geography", sources=[SOURCE], requires=["curated"])
def ingest_geography(ctx: Context) -> None:
    """Biblical places with coordinates, confidence and verse references (OpenBible.info)."""
    path = ctx.find(SOURCE, "ancient.jsonl")
    places = list(read_places(path))
    ids = [p.id for p in places]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise IngestError(f"{path.name}: place ids collide after slugifying: {dupes[:5]}")
    n = write_places(ctx, places, SOURCE)
    if n < 1000:
        raise IngestError(f"only {n} places read from {path.name} — input looks truncated")
    located = sum(1 for p in places if p.lat is not None)
    refs = ctx.con.execute("SELECT count(*) FROM place_ref").fetchone()[0]
    ctx.log.info("  %d places (%d on the map), %d verse references", n, located, refs)
