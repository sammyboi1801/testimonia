"""Kings and rulers: realms, reigns under competing chronologies, and links to the people who reigned.

Curated tables (curated/realms.csv, rulers.csv, reigns.csv, each row citing its source) give
* realms — kingdoms, empires and offices (Judah, Assyria, Roman emperors, high priests…) as `period` rows
  (scope 'realm') with their attributes in `entity_attr` (``realm.*``: short name, style, kind, systems…);
* reigns — `office_holding` rows (``<person>@<realm>``; a second reign adds ``.2``) with ``office.*`` attributes;
* reign dates — `dating` rows (aspect 'reign', plus 'coregency' for a coregency or rival reign before the sole
  reign) under each chronology system: Thiele, Galil and Albright for Israel and Judah, 'scholarly' elsewhere.

Rulers who appear in the Bible are linked to their Theographic person (by its ``personLookup`` id) instead of
being duplicated; everyone else becomes a person of kind 'ruler'. Each gets its Wikipedia article. Years in the
CSV files are written as historians write them ('931 BC', '14' or 'AD 14') and stored astronomically.

The optional ``rulers-wikidata`` step adds each ruler's Wikidata id and the reign dates Wikidata records (its
"position held" statements, from a pinned query) as the 'wikidata' chronology system, and logs where they
disagree with the curated dates.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from ..refs import id_to_key
from .base import Context, IngestError, step
from .curated import SOURCE, read_csv

WIKIDATA = "wikidata"
KINDS = ("local", "overlord", "named")
STYLES = ("of", "office")
SHARED = ("coregency", "rival")
_YEAR = re.compile(r"^(?:AD\s*)?(\d{1,4})(\s*BC)?$", re.I)
_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_QID = re.compile(r"^Q\d+$")
#: Wikidata time precision → `dating.precision`
PRECISION = {7: "century", 8: "decade", 9: "year", 10: "year", 11: "year"}
WIKIDATA_TOLERANCE = 25  # years: a "position held" statement further from the curated reign is another office


def parse_year(text: str) -> int:
    """'931 BC' → -930, '14' or 'AD 14' → 14 (astronomical years: 1 BC = 0). There is no year 0."""
    m = _YEAR.match(text.strip())
    if not m or int(m.group(1)) == 0:
        raise IngestError(f"not a year: {text!r} (write e.g. '931 BC' or 'AD 14')")
    n = int(m.group(1))
    return 1 - n if m.group(2) else n


@dataclass(frozen=True)
class Realm:
    id: str
    name: str
    short: str
    office: str
    style: str
    kind: str
    sort: int
    systems: tuple[str, ...]
    overlord: tuple[int, int] | None
    description: str
    citation: str


@dataclass(frozen=True)
class Holding:
    id: str
    person: str
    name: str
    realm: str
    office: str
    seq: int
    dynasty: str
    scope: str
    theographic: str
    wikipedia: str
    verses: tuple[str, ...]
    note: str


@dataclass(frozen=True)
class Reign:
    holding: str
    system: str
    start: int
    end: int
    approx: bool
    shared_from: int | None
    shared_kind: str
    label: str
    citation: str


def read_realms(rows: Iterable[dict[str, str]]) -> dict[str, Realm]:
    realms: dict[str, Realm] = {}
    for r in rows:
        if not _SLUG.match(r["id"]) or r["id"] in realms:
            raise IngestError(f"realms.csv: bad or duplicate id {r['id']!r}")
        if r["kind"] not in KINDS or r["style"] not in STYLES:
            raise IngestError(f"realms.csv: {r['id']}: kind must be one of {KINDS}, style one of {STYLES}")
        overlord = None
        if r["overlord_from"] or r["overlord_to"]:
            overlord = (parse_year(r["overlord_from"]), parse_year(r["overlord_to"]))
        systems = tuple(s for s in r["systems"].split("|") if s)
        if not systems:
            raise IngestError(f"realms.csv: {r['id']}: no chronology systems")
        realms[r["id"]] = Realm(
            r["id"], r["name"], r["short"], r["office"], r["style"], r["kind"], int(r["sort"]), systems, overlord,
            r["description"], r["citation"],
        )  # fmt: skip
    return realms


def read_holdings(rows: Iterable[dict[str, str]], realms: dict[str, Realm]) -> list[Holding]:
    """One row per reign; ids are ``<person>@<realm>``, with ``.2``, ``.3`` for the same person's later reigns."""
    out: list[Holding] = []
    seen: Counter[str] = Counter()
    seq: Counter[str] = Counter()
    for r in rows:
        if r["realm"] not in realms:
            raise IngestError(f"rulers.csv: {r['person']}: unknown realm {r['realm']!r}")
        if not _SLUG.match(r["person"]):
            raise IngestError(f"rulers.csv: bad person slug {r['person']!r}")
        if r["scope"] not in ("", "named"):
            raise IngestError(f"rulers.csv: {r['person']}: scope must be empty or 'named'")
        verses = tuple(r["verses"].split())
        bad = [v for v in verses if id_to_key(v) is None]
        if bad:
            raise IngestError(f"rulers.csv: {r['person']}: bad verse reference(s) {bad}")
        base = f"{r['person']}@{r['realm']}"
        seen[base] += 1
        seq[r["realm"]] += 1
        out.append(
            Holding(
                id=base if seen[base] == 1 else f"{base}.{seen[base]}",
                person=r["person"],
                name=r["name"],
                realm=r["realm"],
                office=r["office"] or realms[r["realm"]].office,
                seq=seq[r["realm"]],
                dynasty=r["dynasty"],
                scope=r["scope"],
                theographic=r["theographic"],
                wikipedia=r["wikipedia"],
                verses=verses,
                note=r["note"],
            )
        )
    return out


def read_reigns(
    rows: Iterable[dict[str, str]], holdings: list[Holding], realms: dict[str, Realm], systems: set[str]
) -> list[Reign]:
    """Reign dates per chronology system; every reign needs a date in its realm's first (default) system."""
    by_id = {h.id: h for h in holdings}
    out: list[Reign] = []
    keys: set[tuple[str, str]] = set()
    for r in rows:
        h = by_id.get(r["holding"])
        if h is None:
            raise IngestError(f"reigns.csv: unknown reign {r['holding']!r} (expected <person>@<realm>[.n])")
        if r["system"] not in systems:
            raise IngestError(f"reigns.csv: {h.id}: unknown chronology system {r['system']!r}")
        if r["system"] not in realms[h.realm].systems:
            raise IngestError(f"reigns.csv: {h.id}: system {r['system']!r} is not listed for realm {h.realm!r}")
        if (h.id, r["system"]) in keys:
            raise IngestError(f"reigns.csv: {h.id} has two {r['system']} rows")
        keys.add((h.id, r["system"]))
        start, end = parse_year(r["start"]), parse_year(r["end"])
        if start > end:
            raise IngestError(f"reigns.csv: {h.id} ({r['system']}) starts after it ends")
        shared = parse_year(r["shared_from"]) if r["shared_from"] else None
        if shared is not None and (shared >= start or r["shared_kind"] not in SHARED):
            raise IngestError(f"reigns.csv: {h.id}: shared_from must precede start and shared_kind be one of {SHARED}")
        if not r["citation"]:
            raise IngestError(f"reigns.csv: {h.id} ({r['system']}) cites no source")
        out.append(
            Reign(h.id, r["system"], start, end, r["approx"] == "1", shared, r["shared_kind"] if shared else "",
                  r["label"], r["citation"])
        )  # fmt: skip
    missing = [h.id for h in holdings if (h.id, realms[h.realm].systems[0]) not in keys]
    if missing:
        raise IngestError(f"reigns.csv: no dates in the realm's default system for {missing[:8]}")
    return out


def _attr(ctx: Context, uri: str, key: str, value: Any, source: str = SOURCE) -> None:
    if value in (None, "", [], ()):
        return
    ctx.con.execute(
        "INSERT OR REPLACE INTO entity_attr (uri, key, value, source_id) VALUES (?,?,?,?)",
        (uri, key, json.dumps(value, ensure_ascii=False), source),
    )


def write_realms(ctx: Context, realms: dict[str, Realm]) -> None:
    for r in realms.values():
        ctx.con.execute(
            "INSERT INTO period (id, name, scope, sort, description, source_id) VALUES (?,?,'realm',?,?,?)",
            (f"realm-{r.id}", r.name, r.sort, r.description, SOURCE),
        )
        uri = f"period:realm-{r.id}"
        for key, value in (
            ("realm.short", r.short),
            ("realm.office", r.office),
            ("realm.style", r.style),
            ("realm.kind", r.kind),
            ("realm.systems", list(r.systems)),
            ("realm.overlord", list(r.overlord) if r.overlord else None),
            ("realm.citation", r.citation),
        ):
            _attr(ctx, uri, key, value)


def link_people(ctx: Context, holdings: list[Holding], reigns: list[Reign], realms: dict[str, Realm]) -> dict[str, str]:
    """Person id for each ruler slug: the Theographic person when linked, else an existing or new person."""
    con = ctx.con
    theographic = dict(
        con.execute("SELECT value, entity_id FROM external_id WHERE entity_type = 'person' AND scheme = 'theographic'")
    )
    existing = {r[0] for r in con.execute("SELECT id FROM person")}
    default = {g.holding: g for g in reigns if g.system == realms[_realm_of(g.holding)].systems[0]}
    people: dict[str, str] = {}
    unlinked = []
    for h in holdings:
        if h.person in people:
            continue
        pid = theographic.get(h.theographic) if h.theographic else None
        if h.theographic and pid is None:
            unlinked.append(h.theographic)
        if pid is not None:
            # many Theographic kings have no one-line summary: give them their office
            con.execute("UPDATE person SET summary = COALESCE(summary, ?) WHERE id = ?", (h.office, pid))
        elif h.person in existing:
            pid = h.person
        else:
            pid = h.person
            spans = [default[x.id] for x in holdings if x.person == h.person and x.id in default]
            con.execute(
                "INSERT INTO person (id, name, kind, floruit_from, floruit_to, summary, source_id) "
                "VALUES (?,?,'ruler',?,?,?,?)",
                (
                    pid,
                    h.name,
                    min(s.shared_from or s.start for s in spans),
                    max(s.end for s in spans),
                    h.office,
                    SOURCE,
                ),
            )
            existing.add(pid)
        people[h.person] = pid
    if unlinked:  # a partial build without Theographic, or a lookup id that changed upstream
        ctx.log.warning("  %d Theographic people not found (created as rulers): %s", len(unlinked), unlinked[:6])
    return people


def _realm_of(holding_id: str) -> str:
    return holding_id.split("@", 1)[1].split(".", 1)[0]


def write_holdings(ctx: Context, holdings: list[Holding], people: dict[str, str]) -> None:
    con = ctx.con
    for h in holdings:
        pid = people[h.person]
        con.execute(
            "INSERT INTO office_holding (id, person_id, office, seq, notes, source_id) VALUES (?,?,?,?,?,?)",
            (h.id, pid, h.office, h.seq, h.note or None, SOURCE),
        )
        uri = f"office:{h.id}"
        _attr(ctx, uri, "office.realm", h.realm)
        _attr(ctx, uri, "office.name", h.name)
        _attr(ctx, uri, "office.dynasty", h.dynasty)
        _attr(ctx, uri, "office.scope", h.scope)
        con.executemany(
            "INSERT OR IGNORE INTO person_ref (person_id, vkey) VALUES (?, ?)",
            ((pid, id_to_key(v)) for v in h.verses),
        )
        if h.wikipedia:
            con.execute(
                "INSERT OR IGNORE INTO external_id (entity_type, entity_id, scheme, value) VALUES ('person',?,?,?)",
                (pid, "wikipedia", h.wikipedia),
            )


def write_reigns(ctx: Context, reigns: list[Reign]) -> None:
    rows = []
    for g in reigns:
        kind = "point" if g.start == g.end else "span"
        precision = "decade" if g.approx else "year"
        rows.append(("reign", kind, g.start, g.end, precision, int(g.approx), g.label or None, g.citation, g))
        if g.shared_from is not None:
            rows.append((g.shared_kind, "span", g.shared_from, g.start, precision, int(g.approx), None, g.citation, g))
    ctx.con.executemany(
        "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, precision, "
        "circa, label, basis, source_id) VALUES ('office_holding',?,?,?,?,?,?,?,?,?,?,?)",
        ((g.holding, aspect, g.system, kind, a, b, prec, circa, label, basis, SOURCE)
         for aspect, kind, a, b, prec, circa, label, basis, g in rows),
    )  # fmt: skip


def write_realm_spans(ctx: Context, realms: dict[str, Realm], holdings: list[Holding], reigns: list[Reign]) -> None:
    """Each realm's overall span (first to last reign) under its default system."""
    realm_of = {h.id: h.realm for h in holdings}
    for r in realms.values():
        spans = [g for g in reigns if realm_of[g.holding] == r.id and g.system == r.systems[0]]
        if spans:
            start = min(g.shared_from or g.start for g in spans)
            ctx.con.execute(
                "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, "
                "source_id) VALUES ('period', ?, 'when', ?, 'span', ?, ?, ?)",
                (f"realm-{r.id}", r.systems[0], start, max(g.end for g in spans), SOURCE),
            )


def load_curated(systems: set[str]) -> tuple[dict[str, Realm], list[Holding], list[Reign]]:
    realms = read_realms(
        read_csv("realms.csv", ("id", "name", "short", "office", "style", "kind", "sort", "systems", "citation"))
    )
    holdings = read_holdings(read_csv("rulers.csv", ("person", "name", "realm")), realms)
    reigns = read_reigns(
        read_csv("reigns.csv", ("holding", "system", "start", "end", "citation")), holdings, realms, systems
    )
    return realms, holdings, reigns


@step("rulers", sources=[SOURCE], requires=["curated", "theographic"])
def ingest_rulers(ctx: Context) -> None:
    """Kings and rulers: realms, reigns under each chronology system, links to biblical people."""
    systems = {r[0] for r in ctx.con.execute("SELECT id FROM chronology_system")}
    realms, holdings, reigns = load_curated(systems)
    write_realms(ctx, realms)
    people = link_people(ctx, holdings, reigns, realms)
    write_holdings(ctx, holdings, people)
    write_reigns(ctx, reigns)
    write_realm_spans(ctx, realms, holdings, reigns)
    linked = sum(1 for h in holdings if h.theographic and people[h.person] != h.person)
    ctx.log.info(
        "  %d realms, %d reigns (%d people, %d linked to biblical people), %d reign dates",
        len(realms), len(holdings), len(people), linked, len(reigns),
    )  # fmt: skip


# ----------------------------------------------------------------------------- Wikidata


@dataclass(frozen=True)
class Statement:
    position: str  # QID
    label: str
    start: int | None
    end: int | None
    precision: int


def wikidata_year(value: str) -> int:
    """An xsd:dateTime from the query service → its (astronomical) year: '-0715-01-01T00:00:00Z' → -715."""
    m = re.match(r"^([+-]?)(\d+)-", value.strip())
    if not m:
        raise IngestError(f"wikidata: not a date {value!r}")
    year = int(m.group(2))
    return -year if m.group(1) == "-" else year


def parse_wikidata(bindings: Iterable[dict[str, Any]]) -> dict[str, tuple[str, list[Statement]]]:
    """SPARQL result rows → {Wikipedia title: (QID, [position statements with a date])}."""
    out: dict[str, tuple[str, list[Statement]]] = {}
    for b in bindings:
        title = b["title"]["value"]
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        if not _QID.match(qid):
            continue
        _, statements = out.setdefault(title, (qid, []))
        if "pos" not in b or not ("start" in b or "end" in b):
            continue
        start = wikidata_year(b["start"]["value"]) if "start" in b else None
        end = wikidata_year(b["end"]["value"]) if "end" in b else None
        precision = min(int(b[k]["value"]) for k in ("startPrec", "endPrec") if k in b)
        statement = Statement(b["pos"]["value"].rsplit("/", 1)[-1], b.get("posLabel", {}).get("value", ""),
                              start, end, precision)  # fmt: skip
        if statement not in statements:
            statements.append(statement)
    return out


def choose_statement(statements: list[Statement], start: int, end: int, preferred: str | None) -> Statement | None:
    """The statement that best matches a curated reign (closest dates; the realm's usual office breaks ties)."""
    best: tuple[int, int, Statement] | None = None
    for s in statements:
        if s.start is None or s.end is None:
            continue
        distance = abs(s.start - start) + abs(s.end - end)
        if abs(s.start - start) > WIKIDATA_TOLERANCE or abs(s.end - end) > WIKIDATA_TOLERANCE:
            continue
        key = (distance, 0 if s.position == preferred else 1, s)
        if best is None or key[:2] < best[:2]:
            best = key
    return best[2] if best else None


@step("rulers-wikidata", sources=[WIKIDATA], requires=["rulers"], optional=True)
def ingest_rulers_wikidata(ctx: Context) -> None:
    """Wikidata ids of the rulers and the reign dates Wikidata records (the 'wikidata' chronology system)."""
    files = sorted(p for p in ctx.paths(WIKIDATA) if p.name.startswith("rulers-") and p.suffix == ".json")
    if not files:
        raise IngestError("wikidata: the rulers query results have not been fetched")
    bindings: list[dict[str, Any]] = []
    for path in files:
        bindings += json.loads(path.read_text(encoding="utf-8"))["results"]["bindings"]
    items = parse_wikidata(bindings)
    systems = {r[0] for r in ctx.con.execute("SELECT id FROM chronology_system")}
    realms, holdings, reigns = load_curated(systems)
    people = dict(ctx.con.execute("SELECT id, person_id FROM office_holding"))
    default = {g.holding: g for g in reigns if g.system == realms[_realm_of(g.holding)].systems[0]}
    # the office most of a realm's rulers hold in Wikidata ('Roman emperor', 'King of Judah'…)
    usual: dict[str, str] = {}
    for realm in realms:
        counts = Counter(
            s.position for h in holdings if h.realm == realm and h.wikipedia in items for s in items[h.wikipedia][1]
        )
        if counts:
            usual[realm] = counts.most_common(1)[0][0]
    dated, differ, used = 0, [], set()
    for h in holdings:
        if h.wikipedia not in items or h.id not in people:
            continue
        qid, statements = items[h.wikipedia]
        ctx.con.execute(
            "INSERT OR IGNORE INTO external_id (entity_type, entity_id, scheme, value) "
            "VALUES ('person', ?, 'wikidata', ?)",
            (people[h.id], qid),
        )
        g = default[h.id]
        s = choose_statement([x for x in statements if (qid, x) not in used], g.start, g.end, usual.get(h.realm))
        if s is None or s.start is None or s.end is None or s.start > s.end:
            continue
        used.add((qid, s))
        label = s.label if s.label and not _QID.match(s.label) else "position held"
        ctx.con.execute(
            "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, "
            "precision, circa, basis, source_id) "
            "VALUES ('office_holding', ?, 'reign', 'wikidata', ?, ?, ?, ?, ?, ?, ?)",
            (h.id, "point" if s.start == s.end else "span", s.start, s.end, PRECISION.get(s.precision, "century"),
             int(s.precision < 9), f"Wikidata {qid}: {label}", WIKIDATA),
        )  # fmt: skip
        dated += 1
        if (abs(s.start - (g.shared_from or g.start)) > 1 and abs(s.start - g.start) > 1) or abs(s.end - g.end) > 1:
            differ.append(f"{h.id} {g.start}..{g.end} vs {s.start}..{s.end}")
    ctx.log.info("  %d rulers with Wikidata ids, %d reigns dated by Wikidata", len(items), dated)
    if differ:
        ctx.log.info(
            "  Wikidata differs by more than a year from the curated (default) dates for %d reigns:", len(differ)
        )
        for line in differ:
            ctx.log.info("    %s", line)
