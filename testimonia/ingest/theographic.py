"""Biblical people, events and family relations from Theographic Bible Metadata (CC BY-SA 4.0).

Uses the repository's CSV exports (people, places, events) and two GeoJSON files: the Linked Places
gazetteer (``geo/bible-places.geojson``), which says which OpenBible.info place each Theographic place is,
and Paul's journeys (``geo/pauls_journeys_all.geojson``). Biblical people and events get their own ids
(church fathers and church-history events from `history` keep theirs); dates go into `dating` under the
'jones' chronology system that Theographic follows.
"""

from __future__ import annotations

import csv
import html
import json
import math
import re
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import markdown as _md

from ..refs import id_to_key
from .base import Context, IngestError, step
from .geography import Place, slugify, write_places

SOURCE = "theographic"
SYSTEM = "jones"
JOURNEYS = {
    1: ("first", "Paul's first missionary journey", "Acts.13.1-Acts.14.28"),
    2: ("second", "Paul's second missionary journey", "Acts.15.36-Acts.18.22"),
    3: ("third", "Paul's third missionary journey", "Acts.18.23-Acts.21.16"),
    4: ("rome", "Paul's journey to Rome", "Acts.27.1-Acts.28.16"),
}
SYMMETRIC = (
    ("partners", "spouse_of"),
    ("siblings", "sibling_of"),
    ("halfSiblingsSameFather", "half_sibling_of"),
    ("halfSiblingsSameMother", "half_sibling_of"),
)
_PAREN = re.compile(r"^(.*?)\s*\(([^)]+)\)\s*$")
_MDLINK = re.compile(r"\[([^\]]+)\]\(([^)\s]*)\)")
_OSIS_TARGET = re.compile(r"#([1-4]?[A-Za-z]+\.\d+(?:\.\d+)?)$")
_PARENS = re.compile(r"\s*\([^()]*\)")
_SENTENCE = re.compile(r"(?<=[.;])\s+(?=[A-Z“\"])")
_DURATION = re.compile(r"^(\d+)\s*([DWMY])$")
_DATE = re.compile(r"^(-?\d+)(?:-(\d\d)-(\d\d))?$")
_PARAGRAPH = re.compile(r"\n\s*\n")
PARAGRAPH_BREAK = "\n\n"
_COMMAS = re.compile(r",(\s*,)+")


def read_csv(path: Path) -> Iterator[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            yield {k: (v or "").strip() for k, v in row.items() if k}


def split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def vkeys(value: str) -> list[int]:
    return sorted({k for v in split(value) if (k := id_to_key(v)) is not None})


def ranges(keys: list[int]) -> list[tuple[int, int]]:
    """Consecutive verse keys → (start, end) ranges."""
    out: list[tuple[int, int]] = []
    for k in sorted(set(keys)):
        if out and k == out[-1][1] + 1:
            out[-1] = (out[-1][0], k)
        else:
            out.append((k, k))
    return out


def easton_for(text: str, keys: list[int], name: str) -> str:
    """The part of a linked Easton entry that is about this person or place.

    Theographic sometimes joins entries that only share a name (the lots that were cast, then Lot the man), so
    opening paragraphs that neither name them nor cite any of their verses (while citing others) are dropped."""
    paras = [p for p in _PARAGRAPH.split(text.strip()) if p.strip()]
    own = set(keys)
    named = re.compile(rf"\b{re.escape(name)}\b")
    for i, para in enumerate(paras):
        refs = {
            k for m in _MDLINK.finditer(para) if (o := _OSIS_TARGET.search(m.group(2))) and (k := id_to_key(o.group(1)))
        }
        if not refs or refs & own or named.search(para):
            return PARAGRAPH_BREAK.join(paras[i:])
    return ""


def easton_html(text: str) -> str | None:
    """Easton's Bible Dictionary entry (markdown with links like '(/exod#Exod.6.20)') → HTML with in-app verse links."""
    if not text.strip():
        return None

    def link(m: re.Match[str]) -> str:
        label, target = m.group(1), m.group(2)
        ref = _OSIS_TARGET.search(target)
        if not ref:
            return label
        return f'<a data-ref="{html.escape(ref.group(1), quote=True)}">{label}</a>'

    escaped = _MDLINK.sub(link, text.replace("<", "&lt;").replace(">", "&gt;"))  # the source's own markup is text
    return _md.markdown(escaped, output_format="html")


def first_sentence(text: str, limit: int = 220) -> str | None:
    """Opening sentence of a dictionary entry, without its bracketed references."""
    text = " ".join(_PARENS.sub("", _MDLINK.sub(lambda m: m.group(1), text)).split())
    text = _COMMAS.sub(",", text.replace(" ,", ",").replace(" .", "."))
    if not text:
        return None
    s = _SENTENCE.split(text.lstrip("'=*-:;, "), maxsplit=1)[0].rstrip(";:,")
    if len(s) < 30:  # a bare etymology ('Drawn.') says too little
        return None
    if len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s


def parse_year(value: str) -> tuple[int, int | None, int | None] | None:
    """'-4003' → (-4003, None, None); '0030-04-04' → (30, 4, 4). Years are astronomical, as Theographic stores them."""
    m = _DATE.match(value.strip())
    if not m:
        return None
    month, day = (int(m.group(2)), int(m.group(3))) if m.group(2) else (None, None)
    return int(m.group(1)), month, day


def span_end(start: int, duration: str) -> int:
    """Last year of an event that lasted `duration` ('40Y', '18M', '7D')."""
    m = _DURATION.match(duration.strip())
    if not m:
        return start
    n, unit = int(m.group(1)), m.group(2)
    if unit == "Y":
        return start + n
    if unit == "M":
        return start + n // 12
    return start


def person_name(row: dict[str, str]) -> tuple[str, str | None]:
    """Display name and a one-line identification: 'Mary (Mother of Jesus)' → ('Mary', 'Mother of Jesus')."""
    title = row.get("displayTitle") or row["name"]
    m = _PAREN.match(title)
    return (m.group(1), m.group(2)) if m else (title, None)


def preferred_slugs(rows: list[dict[str, str]], key: str) -> dict[str, str]:
    """A readable id for each person whose title is unambiguous ('david', 'mary-mother-of-jesus'), else ''.

    A title equal to a name that others share ('Jesus' for Jesus Justus, beside 'Jesus Christ') is not used."""
    titles = Counter(r.get("displayTitle") or r["name"] for r in rows)
    names = Counter(r["name"] for r in rows)
    out = {}
    for r in rows:
        title = r.get("displayTitle") or r["name"]
        clear = titles[title] == 1 and (title != r["name"] or names[r["name"]] == 1)
        out[r[key]] = slugify(title) if clear else ""
    return out


def assign_ids(keys: list[tuple[str, str, str]], reserved: set[str]) -> dict[str, str]:
    """(source key, preferred slug, fallback slug) → our id: the preferred slug when it is unique and free."""
    counts = Counter(pref for _, pref, _ in keys)
    out: dict[str, str] = {}
    taken = set(reserved)
    for key, pref, fallback in keys:
        new = pref if counts[pref] == 1 and pref and pref not in taken else fallback
        if new in taken:
            raise IngestError(f"{SOURCE}: id {new!r} for {key!r} is already taken")
        taken.add(new)
        out[key] = new
    return out


# ----------------------------------------------------------------------------- places


def crosswalk(gazetteer: dict[str, Any]) -> tuple[dict[str, str], dict[str, list[tuple[str, str]]]]:
    """Theographic place slug → OpenBible ancient id, plus external ids per OpenBible id, from the LPF gazetteer."""
    th_to_ob: dict[str, str] = {}
    ext: dict[str, list[tuple[str, str]]] = {}
    for f in gazetteer.get("features") or []:
        urls = [str(link.get("identifier", "")) for link in f.get("links") or []]
        for n in f.get("names") or []:
            urls += [str(c.get("@id", "")) for c in n.get("citations") or []]
        ob = [m.group(1) for u in urls if (m := re.search(r"openbible\.info/geo/ancient/(a[0-9a-f]+)", u))]
        if not ob:
            continue
        for u in urls:
            if m := re.search(r"theographic\.netlify\.app/place/([^/]+)/", u):
                th_to_ob.setdefault(m.group(1), ob[0])
            elif m := re.search(r"pleiades\.stoa\.org/places/(\d+)", u):
                ext.setdefault(ob[0], []).append(("pleiades", m.group(1)))
            elif m := re.search(r"wikidata\.org/wiki/(Q\d+)", u):
                ext.setdefault(ob[0], []).append(("wikidata", m.group(1)))
    return th_to_ob, ext


def _float(v: str) -> float | None:
    try:
        f = float(v)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def link_places(ctx: Context, rows: list[dict[str, str]], gazetteer: dict[str, Any]) -> dict[str, str]:
    """Map every Theographic place to a place id, adding the few OpenBible lacks; returns slug → place id."""
    con = ctx.con
    by_ob = dict(
        con.execute("SELECT value, entity_id FROM external_id WHERE entity_type='place' AND scheme='openbible'")
    )
    th_to_ob, ext = crosswalk(gazetteer)
    for ob_id, schemes in ext.items():
        if ob_id in by_ob:
            con.executemany(
                "INSERT OR IGNORE INTO external_id (entity_type, entity_id, scheme, value) VALUES ('place', ?, ?, ?)",
                ((by_ob[ob_id], s, v) for s, v in schemes),
            )
    out = {r["placeLookup"]: by_ob[th_to_ob[r["placeLookup"]]] for r in rows if th_to_ob.get(r["placeLookup"]) in by_ob}
    for r in rows:  # an alias that is not in the gazetteer follows its canonical place
        canon = split(r.get("canonicalPlace", ""))
        if r["placeLookup"] not in out and canon and canon[0] in out:
            out[r["placeLookup"]] = out[canon[0]]
    existing = {r[0] for r in con.execute("SELECT id FROM place")}
    missing = [r for r in rows if r["placeLookup"] not in out and vkeys(r.get("verses", ""))]
    ids = assign_ids(
        [(r["placeLookup"], slugify(r["displayTitle"]), f"{slugify(r['kjvName'])}-{r['placeID']}") for r in missing],
        existing,
    )
    added = []
    for r in missing:
        lat, lon = _float(r.get("latitude", "")), _float(r.get("longitude", ""))
        located = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180
        kind = {"City": "city", "Region": "region", "Mountain": "mountain", "Water": "water", "Valley": "valley"}
        added.append(
            Place(
                id=ids[r["placeLookup"]],
                ob_id="",
                name=r["displayTitle"],
                kind=kind.get(r.get("featureType", ""), "site"),
                lat=lat if located else None,
                lon=lon if located else None,
                precision="approximate" if located else "unknown",
                confidence=None,
                modern_name=None,
                summary=r.get("comment") or None,
                alt_names=[],
                vkeys=vkeys(r.get("verses", "")),
            )
        )
        out[r["placeLookup"]] = ids[r["placeLookup"]]
    write_places(ctx, added, SOURCE)
    for r in rows:  # Theographic's (KJV-based) verse lists complement OpenBible's
        if r["placeLookup"] in out:
            con.executemany(
                "INSERT OR IGNORE INTO place_ref (place_id, vkey) VALUES (?, ?)",
                ((out[r["placeLookup"]], k) for k in vkeys(r.get("verses", ""))),
            )
    ctx.log.info("  %d Theographic places matched to OpenBible places, %d added", len(out) - len(added), len(added))
    return out


def write_easton(ctx: Context, uri: str, text: str) -> None:
    body = easton_html(text)
    if body:
        ctx.con.execute(
            "INSERT OR IGNORE INTO entity_attr (uri, key, value, source_id) VALUES (?, 'dict.easton', ?, ?)",
            (uri, json.dumps(body, ensure_ascii=False), SOURCE),
        )


def _link(ctx: Context, src: str, rel: str, dst: str) -> None:
    ctx.con.execute("INSERT INTO entity_link (src, rel, dst, source_id) VALUES (?,?,?,?)", (src, rel, dst, SOURCE))


def _date(
    ctx: Context, etype: str, eid: str, aspect: str, start: int, end: int, month: int | None, day: int | None
) -> None:
    ctx.con.execute(
        "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, start_month, "
        "start_day, precision, circa, source_id) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)",
        (etype, eid, aspect, SYSTEM, "point" if start == end else "span", start, end, month, day,
         "day" if day else "year", SOURCE),
    )  # fmt: skip


# ----------------------------------------------------------------------------- people, events, journeys


def ingest_people(ctx: Context, rows: list[dict[str, str]], places: dict[str, str]) -> dict[str, str]:
    con = ctx.con
    reserved = {r[0] for r in con.execute("SELECT id FROM person")}
    pref = preferred_slugs(rows, "personLookup")
    ids = assign_ids(
        [(r["personLookup"], pref[r["personLookup"]], f"{slugify(r['name'])}-{r['personID']}") for r in rows], reserved
    )
    gender = {r["personLookup"]: r.get("gender", "") for r in rows}
    names = Counter(r["name"] for r in rows)
    for r in rows:
        pid = ids[r["personLookup"]]
        name, summary = person_name(r)
        easton = easton_for(r.get("dictText", ""), vkeys(r["verses"]), r["name"])
        if summary is None and names[r["name"]] == 1:  # Easton's opening line, when the entry can only mean this person
            summary = first_sentence(easton)
        alt = [a for a in dict.fromkeys(split(r.get("alsoCalled", ""))) if a != name]
        born, died = parse_year(r.get("birthYear", "")), parse_year(r.get("deathYear", ""))
        con.execute(
            "INSERT INTO person (id, name, alt_names, sex, kind, born, died, summary, bio, source_id) "
            "VALUES (?,?,?,?,'biblical',?,?,?,?,?)",
            (pid, name, json.dumps(alt, ensure_ascii=False) if alt else None, r.get("gender", "").lower() or None,
             born[0] if born else None, died[0] if died else None, summary, easton_html(easton), SOURCE),
        )  # fmt: skip
        con.executemany(
            "INSERT OR IGNORE INTO person_ref (person_id, vkey) VALUES (?, ?)", ((pid, k) for k in vkeys(r["verses"]))
        )
        con.execute(
            "INSERT INTO external_id (entity_type, entity_id, scheme, value) VALUES ('person', ?, 'theographic', ?)",
            (pid, r["personLookup"]),
        )
        if born:
            _date(ctx, "person", pid, "birth", born[0], born[0], None, None)
        if died:
            _date(ctx, "person", pid, "death", died[0], died[0], None, None)
        groups = split(r.get("memberOf", ""))
        if groups:
            con.execute(
                "INSERT INTO entity_attr (uri, key, value, source_id) VALUES (?, 'bio.groups', ?, ?)",
                (f"person:{pid}", json.dumps(groups, ensure_ascii=False), SOURCE),
            )
        wrote = list(dict.fromkeys(c.split(".")[0] for c in split(r.get("chaptersWritten", ""))))
        if wrote:
            con.execute(
                "INSERT INTO entity_attr (uri, key, value, source_id) VALUES (?, 'bio.wrote', ?, ?)",
                (f"person:{pid}", json.dumps(wrote), SOURCE),
            )
        for field, rel in (("birthPlace", "born_at"), ("deathPlace", "died_at")):
            for slug in split(r.get(field, ""))[:1]:
                if slug in places:
                    _link(ctx, f"person:{pid}", rel, f"place:{places[slug]}")

    rels: set[tuple[str, str, str]] = set()
    for r in rows:
        me = r["personLookup"]
        for field, rel in (("father", "father_of"), ("mother", "mother_of")):
            for parent in split(r.get(field, ""))[:1]:
                if parent in ids:
                    rels.add((ids[parent], rel, ids[me]))
        for child in split(r.get("children", "")):
            if child in ids:
                rels.add((ids[me], "mother_of" if gender[me] == "Female" else "father_of", ids[child]))
        for field, rel in SYMMETRIC:
            for other in split(r.get(field, "")):
                if other in ids and other != me:
                    a, b = sorted((ids[me], ids[other]))  # symmetric relations are stored once
                    rels.add((a, rel, b))
    ctx.insert("person_relation", ["person_a", "relation", "person_b", "source_id"], ((*t, SOURCE) for t in rels))
    return ids


def ingest_events(ctx: Context, rows: list[dict[str, str]], people: dict[str, str], places: dict[str, str]) -> int:
    con = ctx.con
    reserved = {r[0] for r in con.execute("SELECT id FROM event")}
    ids = assign_ids(
        [(r["title"], slugify(r["title"]), f"{slugify(r['title'])}-{r['eventID']}") for r in rows], reserved
    )
    for r in rows:
        eid = ids[r["title"]]
        locs = [places[p] for p in split(r.get("locations", "")) if p in places]
        con.execute(
            "INSERT INTO event (id, title, kind, description, place_id, source_id) VALUES (?,?,'biblical',?,?,?)",
            (eid, r["title"], r.get("notes") or None, locs[0] if locs else None, SOURCE),
        )
        con.execute(
            "INSERT INTO external_id (entity_type, entity_id, scheme, value) VALUES ('event', ?, 'theographic', ?)",
            (eid, r["eventID"]),
        )
        con.executemany(
            "INSERT OR IGNORE INTO event_ref (event_id, start_vkey, end_vkey) VALUES (?,?,?)",
            ((eid, a, b) for a, b in ranges(vkeys(r.get("verses", "")))),
        )
        con.executemany(
            "INSERT OR IGNORE INTO event_participant (event_id, person_id) VALUES (?, ?)",
            ((eid, people[p]) for p in split(r.get("participants", "")) if p in people),
        )
        for place in dict.fromkeys(locs):
            _link(ctx, f"event:{eid}", "located_at", f"place:{place}")
        when = parse_year(r.get("startDate", ""))
        if when:
            _date(ctx, "event", eid, "when", when[0], span_end(when[0], r.get("duration", "")), when[1], when[2])
    for r in rows:  # links between events (titles are unique, so they work as keys)
        for field, rel in (("partOf", "part_of"), ("predecessor", "follows")):
            for other in split(r.get(field, ""))[:1]:
                if other in ids:
                    _link(ctx, f"event:{ids[r['title']]}", rel, f"event:{ids[other]}")
    return len(ids)


def ingest_journeys(ctx: Context, data: dict[str, Any]) -> int:
    """Paul's journeys: one route feature per journey, with its stops (verse, place) in order."""
    lines: dict[int, list[list[list[float]]]] = {j: [] for j in JOURNEYS}
    stops: dict[int, list[dict[str, Any]]] = {j: [] for j in JOURNEYS}
    places = [
        (pid, name.lower(), lat, lon)
        for pid, name, lat, lon in ctx.con.execute("SELECT id, name, lat, lon FROM place WHERE lat IS NOT NULL")
    ]

    def nearest(name: str, lat: float, lon: float) -> str | None:
        best = min(
            ((abs(plat - lat) + abs(plon - lon), pid) for pid, pname, plat, plon in places if pname == name.lower()),
            default=None,
        )
        return best[1] if best and best[0] < 1.5 else None

    for f in data.get("features") or []:
        geom, props = f.get("geometry") or {}, f.get("properties") or {}
        if geom.get("type") == "LineString" and props.get("route_id") in lines:
            lines[props["route_id"]].append([[round(x, 4), round(y, 4)] for x, y, *_ in geom["coordinates"]])
        elif geom.get("type") == "Point":
            lon, lat = geom["coordinates"][:2]
            name = str(props.get("Place Name") or "").strip()
            for j, (key, _, _) in JOURNEYS.items():
                ref = str(props.get(key) or "").strip()
                k = id_to_key(ref)
                if name and k is not None:
                    stops[j].append({"name": name, "osis": ref, "vkey": k, "lat": round(lat, 4), "lon": round(lon, 4),
                                     "place": nearest(name, lat, lon)})  # fmt: skip
    n = 0
    for j, (_, title, refs) in JOURNEYS.items():
        if not lines[j]:
            continue
        ordered = sorted(stops[j], key=lambda s: s["vkey"])
        feature = {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": lines[j]},
            "properties": {
                "journey": j,
                "refs": refs,
                "stops": [{k: v for k, v in s.items() if k != "vkey"} for s in ordered],
            },
        }
        ctx.con.execute(
            "INSERT INTO geo_feature (id, kind, name, geojson, source_id) VALUES (?, 'route', ?, ?, ?)",
            (f"paul-journey-{j}", title, json.dumps(feature, ensure_ascii=False, separators=(",", ":")), SOURCE),
        )
        n += 1
    return n


@step("theographic", sources=[SOURCE], requires=["geography", "history"])
def ingest_theographic(ctx: Context) -> None:
    """Biblical people (family, verses), events (participants, places, Jones dates) and Paul's journeys."""
    place_rows = list(read_csv(ctx.find(SOURCE, "Places.csv")))
    people_rows = list(read_csv(ctx.find(SOURCE, "People.csv")))
    event_rows = list(read_csv(ctx.find(SOURCE, "Events.csv")))
    for name, rows, cols in (
        ("Places.csv", place_rows, ("placeLookup", "displayTitle", "verses")),
        ("People.csv", people_rows, ("personLookup", "name", "verses")),
        ("Events.csv", event_rows, ("title", "eventID", "startDate")),
    ):
        if len(rows) < 100 or any(c not in rows[0] for c in cols):
            raise IngestError(f"{SOURCE}: {name} is truncated or lacks columns {cols}")
    with ctx.find(SOURCE, "bible-places.geojson").open(encoding="utf-8") as fh:
        gazetteer = json.load(fh)
    places = link_places(ctx, place_rows, gazetteer)
    for r in place_rows:
        if r["placeLookup"] in places:
            easton = easton_for(r.get("dictText", ""), vkeys(r.get("verses", "")), r["kjvName"])
            write_easton(ctx, f"place:{places[r['placeLookup']]}", easton)
            note = r.get("comment", "")
            if not note or note.lower().startswith(("same as", "see ")):
                note = first_sentence(easton) or ""
            if note and not r.get("canonicalPlace"):
                ctx.con.execute(
                    "UPDATE place SET summary = COALESCE(summary, ?) WHERE id = ?",
                    (note, places[r["placeLookup"]]),
                )
    people = ingest_people(ctx, people_rows, places)
    for r in place_rows:
        for who in split(r.get("hasBeenHere", "")):
            if who in people and r["placeLookup"] in places:
                _link(ctx, f"person:{people[who]}", "visited", f"place:{places[r['placeLookup']]}")
    events = ingest_events(ctx, event_rows, people, places)
    with ctx.find(SOURCE, "pauls_journeys_all.geojson").open(encoding="utf-8") as fh:
        journeys = ingest_journeys(ctx, json.load(fh))
    rels = ctx.con.execute("SELECT count(*) FROM person_relation WHERE source_id = ?", (SOURCE,)).fetchone()[0]
    ctx.log.info("  %d people (%d family relations), %d events, %d journeys", len(people), rels, events, journeys)
