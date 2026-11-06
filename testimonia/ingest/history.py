"""Church history from curated tables: author lives, work dates, events, eras and Wikipedia links.

Dates are display defaults on `person`/`work` plus full `dating` rows under the 'scholarly' chronology system
(circa flags and windows preserved), so the timeline and the chronology filters read the same numbers.
"""

from __future__ import annotations

from .base import Context, IngestError, step
from .curated import SOURCE, read_csv

SYSTEM = "scholarly"
ERAS = (("apostolic", 150), ("ante-nicene", 325), ("nicene", 451), ("late-patristic", 750), ("medieval", 1500))


def _int(s: str) -> int | None:
    return int(s) if s else None


def era_for(year: int | None) -> str | None:
    """The church era a (composition or floruit) year falls in."""
    if year is None:
        return None
    for era, end in ERAS:
        if year < end:
            return era
    return "reformation"


def _date(
    ctx: Context, etype: str, eid: str, aspect: str, start: int | None, end: int | None, circa: bool, kind: str = "span"
) -> None:
    """One `dating` row; a range is a 'span' (lasted) or a 'window' (happened once, sometime within)."""
    if start is None and end is None:
        return
    if start is not None and end is not None and start > end:
        raise IngestError(f"{etype} {eid}: {aspect} starts after it ends ({start} > {end})")
    if start == end or end is None or start is None:
        kind = "point"
    if kind == "point":
        start = end = start if start is not None else end
    ctx.con.execute(
        "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, precision, "
        "circa, source_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (etype, eid, aspect, SYSTEM, kind, start, end, "year" if not circa else "decade", int(circa), SOURCE),
    )


def _wiki(ctx: Context, etype: str, eid: str, title: str) -> None:
    if title:
        ctx.con.execute(
            "INSERT OR IGNORE INTO external_id (entity_type, entity_id, scheme, value) VALUES (?,?,?,?)",
            (etype, eid, "wikipedia", title),
        )


@step("history", sources=[SOURCE], requires=["ccel", "hcf-commentaries"])
def ingest_history(ctx: Context) -> None:
    """Author life dates and Wikipedia links, work composition dates, church-history events and eras."""
    con = ctx.con
    existing = {r[0] for r in con.execute("SELECT id FROM person")}
    for p in read_csv("people.csv", ("id", "name", "kind")):
        born, died, f_from, f_to = (_int(p[k]) for k in ("born", "died", "floruit_from", "floruit_to"))
        approx = p["approx"]
        era = p["era"] or era_for(f_to)
        values = (p["name"], born, died, f_from, f_to, era, p["tradition"] or None, p["summary"] or None)
        if p["id"] in existing:
            con.execute(
                "UPDATE person SET name=?, born=?, died=?, floruit_from=?, floruit_to=?, era=?, tradition=?, "
                "summary=COALESCE(?, summary) WHERE id=?",
                (*values, p["id"]),
            )
        else:
            con.execute(
                "INSERT INTO person (name, born, died, floruit_from, floruit_to, era, tradition, summary, id, kind, "
                "source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (*values, p["id"], p["kind"], SOURCE),
            )
        _date(ctx, "person", p["id"], "birth", born, born, "b" in approx)
        _date(ctx, "person", p["id"], "death", died, died, "d" in approx)
        _date(ctx, "person", p["id"], "floruit", f_from, f_to, "f" in approx)
        _wiki(ctx, "person", p["id"], p["wikipedia"])

    works = {r[0] for r in con.execute("SELECT id FROM work")}
    missing = []
    for w in read_csv("work_dates.csv", ("work_id",)):
        if w["work_id"] not in works:
            missing.append(w["work_id"])
            continue
        start, end = _int(w["date_from"]), _int(w["date_to"])
        con.execute(
            "UPDATE work SET date_from=?, date_to=?, author_id=COALESCE(?, author_id), category=COALESCE(?, category), "
            "attribution=COALESCE(?, attribution) WHERE id=?",
            (start, end, w["author_id"] or None, w["category"] or None, w["note"] or None, w["work_id"]),
        )
        _date(ctx, "work", w["work_id"], "composition", start, end, w["approx"] == "1", "window")
    if missing:
        ctx.log.warning("work_dates.csv: %d work(s) not in this build (source skipped?): %s", len(missing), missing[:5])

    books = {r[0] for r in con.execute("SELECT osis FROM book")}
    for b in read_csv("book_links.csv", ("osis", "wikipedia")):
        if b["osis"] not in books:
            raise IngestError(f"book_links.csv: unknown book {b['osis']!r}")
        _wiki(ctx, "book", b["osis"], b["wikipedia"])

    for w in read_csv("work_links.csv", ("work_id",)):
        if w["work_id"] in works:
            _wiki(ctx, "work", w["work_id"], w["wikipedia"])
            if w["summary"]:
                con.execute("UPDATE work SET summary=? WHERE id=?", (w["summary"], w["work_id"]))

    # works without their own era take the era of their date, else of their author
    con.execute(
        "UPDATE work SET era = (SELECT p.era FROM person p WHERE p.id = work.author_id) "
        "WHERE era IS NULL AND date_from IS NULL AND author_id IS NOT NULL"
    )
    undated_era = "SELECT id, date_from, date_to FROM work WHERE era IS NULL AND date_from IS NOT NULL"
    for wid, start, end in con.execute(undated_era).fetchall():
        con.execute("UPDATE work SET era=? WHERE id=?", (era_for((start + end) // 2), wid))
    # keep the denormalised citation columns in step with the curated author/date
    con.execute(
        "UPDATE citation SET author_id = (SELECT author_id FROM work WHERE work.id = citation.work_id), "
        "year = COALESCE(year, (SELECT COALESCE(w.date_to, p.floruit_to) FROM work w LEFT JOIN person p "
        "ON p.id = w.author_id WHERE w.id = citation.work_id))"
    )

    for e in read_csv("events.csv", ("id", "title", "kind", "start")):
        con.execute(
            "INSERT INTO event (id, title, kind, description, source_id) VALUES (?,?,?,?,?)",
            (e["id"], e["title"], e["kind"], e["description"] or None, SOURCE),
        )
        start = _int(e["start"])
        end = _int(e["end"]) if e["end"] else start
        _date(ctx, "event", e["id"], "when", start, end, e["approx"] == "1", e["date_kind"])
        _wiki(ctx, "event", e["id"], e["wikipedia"])
        if e.get("major") == "1":  # milestones are drawn across the whole timeline
            con.execute(
                "INSERT INTO entity_attr (uri, key, value, source_id) VALUES (?, 'timeline.major', 'true', ?)",
                (f"event:{e['id']}", SOURCE),
            )

    for i, band in enumerate(read_csv("church_eras.csv", ("id", "name", "start", "end"))):
        con.execute(
            "INSERT INTO period (id, name, scope, sort, description, source_id) VALUES (?,?,?,?,?,?)",
            (band["id"], band["name"], "church", i, band["description"] or None, SOURCE),
        )
        _date(ctx, "period", band["id"], "when", _int(band["start"]), _int(band["end"]), False)
