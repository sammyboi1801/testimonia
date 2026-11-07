"""JSON API for the Testimonia app (read-only over core.db).

Every endpoint is a plain, typed function; FastAPI runs them in a worker thread pool and each worker
uses its own read-only SQLite connection (see store.py).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..books import BOOKS, BY_OSIS, fuzzy_books, norm_alias, resolve_book
from ..ingest.stepbible import normalize
from ..refs import id_to_key, key_to_parts, parse_osis, parse_refs, vkey
from .store import Store

router = APIRouter(prefix="/api")

OUTSIDE = ("jewish", "pagan")  # work categories of non-Christian witnesses
LEXICON_ORDER = ["tbesg", "tbesh", "abbott-smith", "lsj", "bdb"]
WORD_EDITIONS = {"tagnt": "NT", "tahot": "OT"}  # word-data editions (rendered as interlinear)


def store(request: Request) -> Store:
    s: Store = request.app.state.store
    return s


def _range_label(f: dict[str, Any]) -> str:
    """'John 1' for a whole chapter, otherwise 'John 1:1–2:11'."""
    a, b = _osis(f["start_vkey"]).split("."), _osis(f["end_vkey"]).split(".")
    if a[:2] == b[:2] and a[2] in ("0", "1") and f["end_vkey"] % 1000 == 999:
        return f"{a[0]} {a[1]}"
    return f"{a[0]} {a[1]}:{a[2]}–{b[1]}:{b[2]}"


def _osis(k: int) -> str:
    b, c, v = key_to_parts(k)
    return f"{b}.{c}.{v}"


def _verse_key(osis: str) -> int:
    k = id_to_key(osis)
    if k is None:
        raise HTTPException(404, f"unknown verse {osis!r}")
    return k


# ----------------------------------------------------------------------------- meta


@router.get("/meta")
def meta(request: Request) -> dict[str, Any]:
    s = store(request)
    editions = s.all(
        "SELECT id, title, abbrev, language, script_dir, kind, testament, versification_id, year, description, sort "
        # manuscript transcriptions are read on their manuscript's page, not offered as reading texts
        "FROM edition WHERE kind <> 'manuscript' ORDER BY sort, id"
    )
    present = {
        r["book"]: r["chapters"] for r in s.all("SELECT book, max(chapter) AS chapters FROM verse GROUP BY book")
    }
    books = [
        {**r, "chapters": present[r["osis"]]}
        for r in s.all(
            "SELECT osis, name, testament, hebrew_name, greek_name, latin_name, genre, ord, "
            "(SELECT value FROM external_id x WHERE x.entity_type = 'book' AND x.entity_id = book.osis "
            "AND x.scheme = 'wikipedia') AS wikipedia FROM book ORDER BY ord"
        )
        if r["osis"] in present
    ]
    traditions = s.all("SELECT id, name FROM canon_tradition ORDER BY id")
    canon = s.all("SELECT tradition_id, book, ord, division, status FROM canon_book ORDER BY tradition_id, ord")
    build = {r["key"]: r["value"] for r in s.all("SELECT key, value FROM meta")}
    counts = {
        "works": s.scalar("SELECT count(*) FROM work"),
        "citations": s.scalar("SELECT count(*) FROM citation"),
        "commentary": s.scalar("SELECT count(*) FROM commentary_entry"),
    }
    return {
        "editions": editions,
        "books": books,
        "traditions": traditions,
        "canon": canon,
        "build": build,
        "counts": counts,
    }


# ----------------------------------------------------------------------------- reading


@router.get("/chapter/{book}/{chapter}")
def chapter(
    request: Request, book: str, chapter: int, editions: str = Query("kjva,bsb", max_length=400)
) -> dict[str, Any]:
    if book not in BY_OSIS or not 0 < chapter <= BY_OSIS[book].chapters:
        raise HTTPException(404, f"unknown chapter {book} {chapter}")
    s = store(request)
    wanted = [e for e in editions.split(",") if e][:12]
    known = {r["id"] for r in s.all("SELECT id FROM edition")}
    wanted = [e for e in wanted if e in known]
    lo, hi = vkey(book, chapter, 0), vkey(book, chapter, 999)
    verses = s.all("SELECT vkey, osis, verse, red_letter FROM verse WHERE vkey BETWEEN ? AND ? ORDER BY vkey", (lo, hi))
    if not verses:
        raise HTTPException(404, f"no text for {book} {chapter}")
    by_key: dict[int, dict[str, Any]] = {v["vkey"]: {**v, "texts": {}, "words": {}} for v in verses}
    text_eds = [e for e in wanted if e not in WORD_EDITIONS]
    if text_eds:
        marks = ",".join("?" * len(text_eds))
        for r in s.all(
            f"SELECT edition_id, vkey, text, native_ref FROM edition_verse "
            f"WHERE vkey BETWEEN ? AND ? AND edition_id IN ({marks})",
            (lo, hi, *text_eds),
        ):
            if r["vkey"] in by_key:
                by_key[r["vkey"]]["texts"][r["edition_id"]] = {"text": r["text"], "native": r["native_ref"]}
        # translators' footnotes, shown as marks in the text
        for r in s.all(
            f"SELECT edition_id, vkey, n, kind, body, anchor FROM edition_note "
            f"WHERE vkey BETWEEN ? AND ? AND edition_id IN ({marks}) ORDER BY vkey, n",
            (lo, hi, *text_eds),
        ):
            t = by_key.get(r["vkey"], {}).get("texts", {}).get(r["edition_id"])
            if t is not None:
                t.setdefault("notes", []).append({k: r[k] for k in ("n", "kind", "body", "anchor")})
    for ed in (e for e in wanted if e in WORD_EDITIONS):
        for r in s.all(
            "SELECT t.vkey, t.pos, t.surface, t.translit, t.gloss, t.strong, t.lemma_id, t.morph, t.editions, "
            "t.word_type, l.lemma, l.gloss AS lemma_gloss, mc.description AS morph_text "
            "FROM token t LEFT JOIN lemma l ON l.id = t.lemma_id "
            "LEFT JOIN morph_code mc ON mc.code = t.morph "
            "WHERE t.edition_id = ? AND t.vkey BETWEEN ? AND ? ORDER BY t.vkey, t.pos",
            (ed, lo, hi),
        ):
            if r["vkey"] in by_key:
                by_key[r.pop("vkey")]["words"].setdefault(ed, []).append(r)
    headings = s.all(
        "SELECT start_vkey AS vkey, title FROM heading WHERE scheme = 'btb-pericope' "
        "AND start_vkey BETWEEN ? AND ? ORDER BY start_vkey",
        (lo, hi),
    )
    for k, m in chapter_marks(s, lo, hi).items():
        if k in by_key:
            by_key[k]["marks"] = m
    return {
        "book": book,
        "chapter": chapter,
        "name": BY_OSIS[book].name,
        "editions": wanted,
        "verses": list(by_key.values()),
        "headings": headings,
        "prev": _neighbour(s, book, chapter, -1),
        "next": _neighbour(s, book, chapter, +1),
    }


MAX_MARK_SPAN = 12  # citations of long passages (whole chapters) are not marked on every verse


def chapter_marks(s: Store, lo: int, hi: int) -> dict[int, dict[str, int]]:
    """Per-verse indicators for the reader margin: variants, church-father citations, OT/NT links."""
    marks: dict[int, dict[str, int]] = {}

    def bump(k: int, key: str, n: int = 1) -> None:
        m = marks.setdefault(k, {})
        m[key] = m.get(key, 0) + n

    for r in s.all(
        "SELECT start_vkey, count(*) AS n, sum(significance IN ('meaning', 'omission', 'ketiv-qere')) AS major "
        "FROM variant_unit WHERE start_vkey BETWEEN ? AND ? GROUP BY start_vkey",
        (lo, hi),
    ):
        bump(r["start_vkey"], "variants", r["n"])
        if r["major"]:
            bump(r["start_vkey"], "major_variants", r["major"])
    book_lo = lo - lo % 1_000_000
    for r in s.all(
        "SELECT c.start_vkey, c.end_vkey, c.year, w.category IN ('jewish', 'pagan') AS outside FROM citation c "
        "JOIN work w ON w.id = c.work_id WHERE c.start_vkey BETWEEN ? AND ? AND c.end_vkey >= ?",
        (book_lo, hi, lo),
    ):
        if r["end_vkey"] - r["start_vkey"] > MAX_MARK_SPAN:
            continue
        for k in range(max(r["start_vkey"], lo), min(r["end_vkey"], hi) + 1):
            if r["outside"]:  # Josephus, Tacitus…: not church fathers
                bump(k, "witnesses")
                continue
            bump(k, "fathers")
            if r["year"] is not None and r["year"] <= 325:
                bump(k, "pre_nicene")
    for r in s.all(
        "SELECT src_start AS k FROM quotation WHERE src_start BETWEEN ? AND ? "
        "UNION ALL SELECT dst_start FROM quotation WHERE dst_start BETWEEN ? AND ?",
        (lo, hi, lo, hi),
    ):
        bump(r["k"], "quotations")
    return marks


def _neighbour(s: Store, book: str, chapter: int, step: int) -> dict[str, Any] | None:
    here = vkey(book, chapter, 0)
    if step > 0:
        k = s.scalar("SELECT min(vkey) FROM verse WHERE vkey >= ? AND verse > 0", (vkey(book, chapter, 999) + 1,))
    else:
        k = s.scalar("SELECT max(vkey) FROM verse WHERE vkey < ? AND verse > 0", (here,))
    if k is None:
        return None
    b, c, _ = key_to_parts(k)
    return {"book": b, "chapter": c, "name": BY_OSIS[b].name}


# ----------------------------------------------------------------------------- passage guide


@router.get("/verse/{osis}")
def verse(request: Request, osis: str, preview: str = "bsb", limit: int = Query(60, ge=1, le=500)) -> dict[str, Any]:
    s = store(request)
    k = _verse_key(osis)
    v = s.one("SELECT vkey, osis, book, chapter, verse, red_letter FROM verse WHERE vkey = ?", (k,))
    if v is None:
        raise HTTPException(404, f"no such verse {osis!r}")
    book_lo = k - (k % 1_000_000)

    def preview_text(key: int) -> str | None:
        r = s.one(
            "SELECT text FROM edition_verse WHERE vkey = ? AND edition_id IN (?, 'kjva', 'web') "
            "ORDER BY edition_id = ? DESC LIMIT 1",
            (key, preview, preview),
        )
        return r["text"] if r else None

    texts = s.all(
        "SELECT ev.edition_id, ev.text, ev.native_ref, e.abbrev, e.language, e.script_dir FROM edition_verse ev "
        "JOIN edition e ON e.id = ev.edition_id WHERE ev.vkey = ? AND e.kind <> 'manuscript' ORDER BY e.sort",
        (k,),
    )
    words = {
        ed: s.all(
            "SELECT t.pos, t.surface, t.translit, t.gloss, t.strong, t.lemma_id, t.morph, t.editions, t.word_type, "
            "t.parts, l.lemma, l.gloss AS lemma_gloss FROM token t LEFT JOIN lemma l ON l.id = t.lemma_id "
            "WHERE t.edition_id = ? AND t.vkey = ? ORDER BY t.pos",
            (ed, k),
        )
        for ed in WORD_EDITIONS
    }
    variants = []
    for u in s.all("SELECT id, label, significance, note, source_id FROM variant_unit WHERE start_vkey = ?", (k,)):
        readings = s.all(
            "SELECT r.n, r.text, r.gloss, group_concat(w.witness_type || ':' || w.witness_id "
            "|| coalesce(':' || w.qualifier, ''), ' ') AS witnesses FROM variant_reading r "
            "LEFT JOIN variant_witness w ON w.unit_id = r.unit_id AND w.n = r.n WHERE r.unit_id = ? GROUP BY r.n",
            (u["id"],),
        )
        variants.append({**u, "readings": readings})
    xrefs = s.all(
        "SELECT dst_start, dst_end, votes, source_id FROM crossref WHERE src_start = ? "
        "ORDER BY votes IS NULL, votes DESC LIMIT ?",
        (k, limit),
    )
    for x in xrefs:
        x["osis"] = _osis(x["dst_start"])
        x["end_osis"] = _osis(x["dst_end"]) if x["dst_end"] != x["dst_start"] else None
        x["text"] = preview_text(x["dst_start"])
    quotes = s.all(
        "SELECT 'quotes' AS direction, dst_start AS other, via FROM quotation WHERE src_start = ? "
        "UNION ALL SELECT 'quoted_by', src_start, via FROM quotation WHERE dst_start = ?",
        (k, k),
    )
    for q in quotes:
        q["osis"] = _osis(q["other"])
        q["text"] = preview_text(q["other"])
    fathers = s.all(
        "SELECT c.work_id, w.title AS work_title, w.category, c.author_id, p.name AS author, c.year, w.era, c.kind, "
        "c.cite, c.snippet, c.edition_id, c.section_ord, c.source_id, c.start_vkey, c.end_vkey FROM citation c "
        "JOIN work w ON w.id = c.work_id LEFT JOIN person p ON p.id = c.author_id "
        "WHERE c.start_vkey BETWEEN ? AND ? AND c.end_vkey >= ? ORDER BY c.year IS NULL, c.year, w.title LIMIT ?",
        (book_lo, k, k, limit * 4),
    )
    # A reference to a whole chapter ('John 1' in an index) is not a citation of this verse: keep those apart, so a
    # verse's list only holds writers who quote or point to it (or a short passage around it).
    wide = [f for f in fathers if f["end_vkey"] - f["start_vkey"] > MAX_MARK_SPAN]
    fathers = [f for f in fathers if f["end_vkey"] - f["start_vkey"] <= MAX_MARK_SPAN]
    broad: dict[tuple[Any, ...], dict[str, Any]] = {}
    for f in wide:
        broad.setdefault((f["work_id"], f["edition_id"], f["section_ord"]), {**f, "times": 1, "scope": _range_label(f)})
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for f in fathers:
        key = (f["work_id"], f["edition_id"], f["section_ord"])
        if key in merged:
            merged[key]["times"] += 1
        else:
            merged[key] = {**f, "times": 1}
    # Jewish and Roman writers (Josephus, Tacitus…) are listed apart from the church fathers
    witnesses = [f for f in merged.values() if f["category"] in OUTSIDE]
    fathers = [f for f in merged.values() if f["category"] not in OUTSIDE]
    commentary = s.all(
        "SELECT e.id, e.start_vkey, e.end_vkey, e.work_title, e.html, e.source_url, c.title AS author, c.year, "
        "c.era, c.author_id FROM commentary_entry e JOIN commentary c ON c.id = e.commentary_id "
        "WHERE e.start_vkey BETWEEN ? AND ? AND e.end_vkey >= ? ORDER BY c.year IS NULL, c.year LIMIT ?",
        (book_lo, k, k, limit * 4),
    )
    notes = s.all("SELECT n, kind, body FROM verse_note WHERE vkey = ? ORDER BY n", (k,))
    topics = s.all(
        "SELECT t.id, t.name FROM topic_ref r JOIN topic t ON t.id = r.topic_id WHERE r.start_vkey = ? ORDER BY t.name",
        (k,),
    )
    chronology = s.one("SELECT label, start_year, end_year, chron_order FROM verse_date WHERE vkey = ?", (k,))
    periods = s.all(
        "SELECT p.id, p.name, p.parent_id FROM verse_period vp JOIN period p ON p.id = vp.period_id "
        "WHERE vp.vkey = ? ORDER BY p.parent_id IS NOT NULL",
        (k,),
    )
    heading = s.one(
        "SELECT title, start_vkey, end_vkey FROM heading WHERE scheme = 'btb-pericope' AND start_vkey <= ? "
        "AND end_vkey >= ? ORDER BY start_vkey DESC LIMIT 1",
        (k, k),
    )
    notes = s.all(
        "SELECT n.edition_id, e.abbrev, n.n, n.kind, n.body, n.anchor FROM edition_note n "
        "JOIN edition e ON e.id = n.edition_id WHERE n.vkey = ? ORDER BY e.sort, n.n",
        (k,),
    )
    return {
        "verse": v,
        "texts": texts,
        "footnotes": notes,
        "words": words,
        "variants": variants,
        "crossrefs": xrefs,
        "quotations": quotes,
        "fathers": fathers,
        "fathers_broad": sorted(broad.values(), key=lambda f: (f["year"] is None, f["year"] or 0)),
        "witnesses": witnesses,
        "commentary": commentary,
        "notes": notes,
        "topics": topics,
        "chronology": chronology,
        "periods": periods,
        "heading": heading,
    }


# ----------------------------------------------------------------------------- words


@router.get("/word/{strong}")
def word(request: Request, strong: str, limit: int = Query(300, ge=1, le=2000)) -> dict[str, Any]:
    if not re.match(r"^[GH]\d{4}[A-Za-z]?$", strong):
        raise HTTPException(400, "expected an extended Strong's number such as G3439 or H0430G")
    s = store(request)
    lemma = s.one("SELECT * FROM lemma WHERE id = ?", (strong,))
    base = strong[:5]
    entries = s.all(
        "SELECT le.lexicon_id, lx.title, le.lemma_id, le.body FROM lexicon_entry le JOIN lexicon lx ON lx.id = "
        "le.lexicon_id WHERE le.lemma_id IN (?, ?)",
        (strong, base),
    )
    entries.sort(key=lambda e: LEXICON_ORDER.index(e["lexicon_id"]) if e["lexicon_id"] in LEXICON_ORDER else 99)
    if lemma is None and not entries:
        raise HTTPException(404, f"unknown word {strong}")
    by_book = s.all(
        "SELECT b.osis AS book, b.name, count(*) AS n FROM token t JOIN book b ON b.ord = t.vkey / 1000000 "
        "WHERE t.lemma_id = ? GROUP BY b.osis ORDER BY b.ord",
        (strong,),
    )
    occurrences = s.all(
        "SELECT t.vkey, t.surface, t.gloss, t.morph, t.edition_id FROM token t WHERE t.lemma_id = ? "
        "ORDER BY t.vkey LIMIT ?",
        (strong, limit),
    )
    for o in occurrences:
        o["osis"] = _osis(o["vkey"])
    glosses = s.all(
        "SELECT gloss, count(*) AS n FROM token WHERE lemma_id = ? AND gloss IS NOT NULL GROUP BY gloss "
        "ORDER BY n DESC LIMIT 25",
        (strong,),
    )
    return {
        "lemma": lemma,
        "lexicons": entries,
        "by_book": by_book,
        "occurrences": occurrences,
        "total": sum(b["n"] for b in by_book),
        "glosses": glosses,
    }


@router.get("/morph/{code}")
def morph(request: Request, code: str) -> dict[str, Any]:
    r = store(request).one("SELECT * FROM morph_code WHERE code = ?", (code,))
    if r is None:
        raise HTTPException(404, f"unknown morphology code {code}")
    return r


# ----------------------------------------------------------------------------- library


@router.get("/book/{osis}")
def book_guide(request: Request, osis: str, preview: str = "bsb") -> dict[str, Any]:
    """Everything about one book of the Bible: introduction, outline, its use by the fathers, OT/NT links,
    textual history and narrative chronology."""
    s = store(request)
    b = s.one(
        "SELECT osis, name, testament, hebrew_name, greek_name, latin_name, genre, ord, orig_language, "
        "(SELECT value FROM external_id x WHERE x.entity_type = 'book' AND x.entity_id = book.osis "
        "AND x.scheme = 'wikipedia') AS wikipedia FROM book WHERE osis = ?",
        (osis,),
    )
    if b is None:
        raise HTTPException(404, f"unknown book {osis!r}")
    lo, hi = b["ord"] * 1_000_000, b["ord"] * 1_000_000 + 999_999
    span = (lo, hi)

    def text(k: int) -> str | None:
        r = s.one(
            "SELECT text FROM edition_verse WHERE vkey = ? AND edition_id IN (?, 'kjva', 'web') "
            "ORDER BY edition_id = ? DESC LIMIT 1",
            (k, preview, preview),
        )
        return r["text"] if r else None

    stats = s.one(
        "SELECT (SELECT count(*) FROM verse WHERE vkey BETWEEN ? AND ? AND verse > 0) AS verses, "
        "(SELECT max(chapter) FROM verse WHERE vkey BETWEEN ? AND ?) AS chapters, "
        "(SELECT count(*) FROM token WHERE vkey BETWEEN ? AND ? AND edition_id IN ('tagnt', 'tahot')) AS words, "
        "(SELECT count(*) FROM variant_unit WHERE start_vkey BETWEEN ? AND ?) AS variants, "
        "(SELECT count(*) FROM citation c JOIN work w ON w.id = c.work_id WHERE c.start_vkey BETWEEN ? AND ? "
        "AND w.category NOT IN ('jewish', 'pagan')) AS citations",
        span * 5,
    )
    outline = s.all(
        "SELECT h.title, h.start_vkey, h.end_vkey FROM heading h WHERE h.scheme = 'btb-pericope' "
        "AND h.start_vkey BETWEEN ? AND ? ORDER BY h.start_vkey",
        span,
    )
    for h in outline:
        h["osis"] = _osis(h["start_vkey"])
        h["chapter"] = (h["start_vkey"] // 1000) % 1000
    # most-quoted verses by the church fathers (pre-Nicene counted separately)
    quoted = s.all(
        "SELECT c.start_vkey AS vkey, count(*) AS n, sum(c.year <= 325) AS pre_nicene FROM citation c "
        "JOIN work w ON w.id = c.work_id WHERE c.start_vkey BETWEEN ? AND ? AND c.end_vkey - c.start_vkey < 3 "
        "AND w.category NOT IN ('jewish', 'pagan') GROUP BY c.start_vkey ORDER BY n DESC LIMIT 12",
        span,
    )
    for q in quoted:
        q["osis"] = _osis(q["vkey"])
        q["text"] = text(q["vkey"])
    readers = s.all(
        "SELECT c.author_id AS id, p.name, min(c.year) AS year, count(*) AS n FROM citation c "
        "JOIN work w ON w.id = c.work_id JOIN person p ON p.id = c.author_id "
        "WHERE c.start_vkey BETWEEN ? AND ? AND w.category NOT IN ('jewish', 'pagan') "
        "GROUP BY c.author_id ORDER BY n DESC LIMIT 12",
        span,
    )
    links = s.all(
        "SELECT src_start, dst_start, kind FROM quotation WHERE src_start BETWEEN ? AND ? "
        "UNION SELECT src_start, dst_start, kind FROM quotation WHERE dst_start BETWEEN ? AND ? ORDER BY 1",
        span * 2,
    )
    quotes = []
    for q in links:
        inside = lo <= q["src_start"] <= hi
        here, other = (q["src_start"], q["dst_start"]) if inside else (q["dst_start"], q["src_start"])
        quotes.append({"here": _osis(here), "other": _osis(other), "direction": "quotes" if inside else "quoted_by"})
    variants = s.all(
        "SELECT significance, count(*) AS n FROM variant_unit WHERE start_vkey BETWEEN ? AND ? "
        "GROUP BY significance ORDER BY n DESC",
        span,
    )
    notable = s.all(
        "SELECT start_vkey, label FROM variant_unit WHERE start_vkey BETWEEN ? AND ? AND significance = 'meaning' "
        "ORDER BY start_vkey LIMIT 40",
        span,
    )
    for v in notable:
        v["osis"] = _osis(v["start_vkey"])
    when = s.one(
        "SELECT min(COALESCE(start_year, end_year)) AS start, max(COALESCE(end_year, start_year)) AS end "
        "FROM verse_date WHERE vkey BETWEEN ? AND ? "
        "AND system_id = 'btb'",
        span,
    )
    periods = s.all(
        "SELECT p.id, p.name, count(*) AS verses, min(vp.vkey) AS first FROM verse_period vp "
        "JOIN period p ON p.id = vp.period_id WHERE vp.vkey BETWEEN ? AND ? AND p.parent_id IS NOT NULL "
        "GROUP BY p.id ORDER BY first",
        span,
    )
    for pr in periods:
        pr["osis"] = _osis(pr["first"])
    witnesses = s.all(
        "SELECT c.start_vkey, p.name AS author, w.title AS work_title, c.cite, c.snippet, c.edition_id, "
        "c.section_ord FROM citation c JOIN work w ON w.id = c.work_id JOIN person p ON p.id = c.author_id "
        "WHERE c.start_vkey BETWEEN ? AND ? AND w.category IN ('jewish', 'pagan') AND c.kind = 'reference' "
        "ORDER BY c.start_vkey",
        span,
    )
    for w_ in witnesses:
        w_["osis"] = _osis(w_["start_vkey"])
    return {
        "book": b,
        "stats": stats,
        "outline": outline,
        "quoted": quoted,
        "readers": readers,
        "quotations": quotes,
        "variants": variants,
        "notable_variants": notable,
        "chronology": when,
        "periods": periods,
        "witnesses": witnesses,
    }


@router.get("/works")
def works(request: Request) -> list[dict[str, Any]]:
    return store(request).all(
        "SELECT w.id, w.title, w.category, w.era, w.author_id, p.name AS author, "
        "COALESCE(w.date_to, p.floruit_to) AS year, w.date_from, w.date_to, "
        "(SELECT count(*) FROM citation c WHERE c.work_id = w.id) AS citations, "
        "(SELECT min(id) FROM work_edition we WHERE we.work_id = w.id) AS edition_id "
        "FROM work w LEFT JOIN person p ON p.id = w.author_id "
        "ORDER BY COALESCE(w.date_to, p.floruit_to) IS NULL, COALESCE(w.date_to, p.floruit_to), p.name, w.title"
    )


INTRO_TITLE = re.compile(r"^(introduct|prefatory|translator)", re.I)  # editor's notes, not an author's own preface


@router.get("/edition/{edition_id}/toc")
def toc(request: Request, edition_id: str) -> dict[str, Any]:
    s = store(request)
    ed = s.one(
        "SELECT we.*, w.title, w.category, w.era, w.summary, w.attribution, w.date_from, w.date_to, w.author_id, "
        "p.name AS author, p.born AS author_born, p.died AS author_died, p.floruit_from AS author_from, "
        "p.floruit_to AS author_to, p.summary AS author_summary, "
        "(SELECT value FROM external_id x WHERE x.entity_type='work' AND x.entity_id=w.id AND scheme='wikipedia') "
        "AS wikipedia, "
        "(SELECT value FROM external_id x WHERE x.entity_type='person' AND x.entity_id=w.author_id "
        "AND scheme='wikipedia') AS author_wikipedia "
        "FROM work_edition we JOIN work w ON w.id = we.work_id LEFT JOIN person p ON p.id = w.author_id "
        "WHERE we.id = ?",
        (edition_id,),
    )
    if ed is None:
        raise HTTPException(404, "unknown edition")
    sections = s.all(
        "SELECT ord, cite, title, level FROM work_section WHERE edition_id = ? ORDER BY ord", (edition_id,)
    )
    # the editor's (public-domain) introduction, when the volume has one at the start of the work
    intro = next((x["ord"] for x in sections[:3] if x["title"] and INTRO_TITLE.match(x["title"])), None)
    return {"edition": ed, "sections": sections, "intro_ord": intro}


@router.get("/timeline")
def timeline(request: Request) -> dict[str, Any]:
    """Everything the library timeline draws: eras, events, dated authors with their works, dated anonymous works."""
    s = store(request)
    wiki = {
        (r["entity_type"], r["entity_id"]): r["value"]
        for r in s.all("SELECT entity_type, entity_id, value FROM external_id WHERE scheme = 'wikipedia'")
    }
    circa: dict[tuple[str, str], set[str]] = {}
    for r in s.all("SELECT entity_type, entity_id, aspect FROM dating WHERE circa = 1 AND system_id = 'scholarly'"):
        circa.setdefault((r["entity_type"], r["entity_id"]), set()).add(r["aspect"])
    eras = s.all(
        "SELECT p.id, p.name, p.description, d.start_year AS start, d.end_year AS end FROM period p "
        "JOIN dating d ON d.entity_type = 'period' AND d.entity_id = p.id WHERE p.scope = 'church' ORDER BY p.sort"
    )
    events = s.all(
        "SELECT e.id, e.title, e.kind, e.description, d.start_year AS start, d.end_year AS end, d.date_kind, d.circa "
        "FROM event e JOIN dating d ON d.entity_type = 'event' AND d.entity_id = e.id "
        "WHERE e.source_id IS NOT 'theographic' ORDER BY d.start_year"  # biblical events have their own pages
    )
    major = {
        r["uri"].split(":", 1)[1]
        for r in s.all("SELECT uri FROM entity_attr WHERE key = 'timeline.major' AND uri LIKE 'event:%'")
    }
    for e in events:
        e["wikipedia"] = wiki.get(("event", e["id"]))
        e["major"] = e["id"] in major
    works = s.all(
        "SELECT w.id, w.title, w.category, w.author_id, w.date_from, w.date_to, w.summary, "
        "(SELECT count(*) FROM citation c WHERE c.work_id = w.id) AS citations, "
        "(SELECT min(id) FROM work_edition we WHERE we.work_id = w.id) AS edition_id FROM work w ORDER BY w.title"
    )
    by_author: dict[str, list[dict[str, Any]]] = {}
    anonymous = []
    for w in works:
        w["wikipedia"] = wiki.get(("work", w["id"]))
        if w["author_id"]:
            by_author.setdefault(w["author_id"], []).append(w)
        elif w["date_from"] is not None:
            anonymous.append(w)
    authors = s.all(
        "SELECT id, name, born, died, floruit_from, floruit_to, era, tradition, summary FROM person "
        "WHERE id IN (SELECT author_id FROM work) AND COALESCE(born, floruit_from, floruit_to, died) IS NOT NULL "
        "ORDER BY COALESCE(floruit_to, died)"
    )
    for a in authors:
        a["wikipedia"] = wiki.get(("person", a["id"]))
        a["circa"] = sorted(circa.get(("person", a["id"]), ()))
        a["works"] = by_author.get(a["id"], [])
        a["category"] = _main_category(a["works"])
    return {"eras": eras, "events": events, "authors": authors, "works": anonymous}


def _main_category(works: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = {}
    for w in works:
        counts[w["category"]] = counts.get(w["category"], 0) + 1
    return max(counts, key=lambda c: counts[c]) if counts else "church-father"


@router.get("/edition/{edition_id}/section/{ord_}")
def section(request: Request, edition_id: str, ord_: int) -> dict[str, Any]:
    s = store(request)
    sec = s.one("SELECT * FROM work_section WHERE edition_id = ? AND ord = ?", (edition_id, ord_))
    if sec is None:
        raise HTTPException(404, "unknown section")
    total = s.scalar("SELECT max(ord) FROM work_section WHERE edition_id = ?", (edition_id,))
    cites = s.all(
        "SELECT start_vkey, end_vkey, kind FROM citation WHERE edition_id = ? AND section_ord = ?", (edition_id, ord_)
    )
    for c in cites:
        c["osis"] = _osis(c["start_vkey"])
    return {
        "section": sec,
        "citations": cites,
        "prev": ord_ - 1 if ord_ > 1 else None,
        "next": ord_ + 1 if ord_ < (total or 0) else None,
    }


# ----------------------------------------------------------------------------- search & references


def fts_query(q: str) -> str:
    """User text → safe FTS5 query: each word quoted; the last one is a prefix search."""
    terms = [t for t in re.findall(r"[\wͰ-Ͽἀ-῿֐-׿]+", q) if t]
    if not terms:
        return ""
    quoted = [f'"{t}"' for t in terms[:-1]] + [f'"{terms[-1]}"*']
    return " ".join(quoted)


@router.get("/search")
def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    scope: str = "all",
    edition: str | None = None,
    limit: int = Query(30, ge=1, le=200),
) -> dict[str, Any]:
    s = store(request)
    match = fts_query(q)
    out: dict[str, Any] = {"query": q}
    ref, alts = pick_ref(s, q)
    if ref:
        out["reference"] = ref
    if alts:
        out["suggestions"] = alts  # "did you mean": other books the typed name could be
    if ORIGINAL_SCRIPT.search(q):
        out.update(original_language_search(s, q, limit))
        if scope in ("all", "bible"):
            terms = [normalize(t) for t in q.split() if normalize(t)]
            greek = greek_text_search(s, terms, limit, edition)
            out["bible"] = sorted([*out.get("bible", []), *greek], key=lambda h: h["vkey"])
        return out
    if not match:
        return out
    if scope in ("all", "bible"):
        params: list[Any] = [match]
        extra = ""
        if edition:
            extra, params = " AND ev.edition_id = ?", [match, edition]
        out["bible"] = s.all(
            "SELECT ev.vkey, ev.edition_id, e.abbrev, snippet(fts_verse, 0, '<mark>', '</mark>', '…', 24) AS snippet "
            "FROM fts_verse JOIN edition_verse ev ON ev.rowid = fts_verse.rowid JOIN edition e ON e.id = ev.edition_id "
            f"WHERE fts_verse MATCH ?{extra} ORDER BY rank LIMIT ?",
            (*params, limit),
        )
        for r in out["bible"]:
            r["osis"] = _osis(r["vkey"])
    if scope in ("all", "works"):
        out["works"] = s.all(
            "SELECT ws.edition_id, ws.ord, ws.cite, ws.title AS section_title, w.title AS work_title, "
            "p.name AS author, "
            "snippet(fts_work, 1, '<mark>', '</mark>', '…', 24) AS snippet FROM fts_work "
            "JOIN work_section ws ON ws.rowid = fts_work.rowid JOIN work_edition we ON we.id = ws.edition_id "
            "JOIN work w ON w.id = we.work_id LEFT JOIN person p ON p.id = w.author_id "
            "WHERE fts_work MATCH ? ORDER BY rank LIMIT ?",
            (match, limit),
        )
    if scope in ("all", "lexicon"):
        out["lexicon"] = s.all(
            "SELECT l.id, l.lemma, l.translit, l.gloss FROM fts_lexicon JOIN lemma l ON l.rowid = fts_lexicon.rowid "
            "WHERE fts_lexicon MATCH ? ORDER BY rank LIMIT ?",
            (match, limit),
        )
    return out


ORIGINAL_SCRIPT = re.compile(r"[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF]")


def original_language_search(s: Store, q: str, limit: int) -> dict[str, Any]:
    """Greek/Hebrew queries match words regardless of accents or vowel points ('λογος' finds λόγος, λόγου…)."""
    terms = [normalize(t) for t in q.split() if normalize(t)]
    if not terms:
        return {}
    first = terms[0]
    # verses containing every term (any inflected form starting with the term)
    hits = s.all(
        "SELECT t.vkey, group_concat(t.surface, ' ') AS words, t.edition_id FROM token t "
        "WHERE t.normalized >= ? AND t.normalized < ? GROUP BY t.vkey, t.edition_id ORDER BY t.vkey LIMIT ?",
        (first, first + "\uffff", limit * 5),
    )
    for extra in terms[1:]:
        keep = {
            r["vkey"]
            for r in s.all(
                "SELECT DISTINCT vkey FROM token WHERE normalized >= ? AND normalized < ?", (extra, extra + "\uffff")
            )
        }
        hits = [h for h in hits if h["vkey"] in keep]
    words = []
    for h in hits[:limit]:
        h["osis"] = _osis(h["vkey"])
        h["abbrev"] = "Greek" if h["edition_id"] == "tagnt" else "Hebrew"
        h["snippet"] = f"<mark>{h.pop('words')}</mark>"
        words.append(h)
    lemmas = [
        r
        for r in s.all("SELECT id, lemma, translit, gloss FROM lemma WHERE language IN ('grc', 'hbo', 'arc')")
        if normalize(r["lemma"] or "").startswith(first)
    ]
    lemmas.sort(key=lambda r: (normalize(r["lemma"]) != first, len(r["lemma"] or "")))
    return {"bible": words, "lexicon": lemmas[:limit], "works": []}


#: Greek running texts (the Septuagint) with an accent-free copy for search, per database file. The FTS
#: index folds Latin accents only, so 'λογος' would not find 'λόγος' there.
_GREEK_TEXTS: dict[str, list[tuple[int, str, str | None, str, str]]] = {}


_COMBINING = dict.fromkeys(range(0x300, 0x370))  # Greek accents and breathings after NFD
_NON_WORD = re.compile(r"\W")


def _fold(text: str) -> list[str]:
    """'Ἐν ἀρχῇ ἐποίησεν' → ['εν', 'αρχη', 'εποιησεν']: the forms ``normalize`` gives word by word, faster."""
    base = unicodedata.normalize("NFC", unicodedata.normalize("NFD", text).translate(_COMBINING)).lower()
    return [w for w in (_NON_WORD.sub("", t) for t in base.split()) if w]


def _greek_texts(s: Store) -> list[tuple[int, str, str | None, str, str]]:
    key = str(s.path)
    rows = _GREEK_TEXTS.get(key)
    if rows is None:
        rows = [
            (r["vkey"], r["edition_id"], r["abbrev"], r["text"], " " + " ".join(_fold(r["text"])))
            for r in s.all(
                "SELECT ev.vkey, ev.edition_id, e.abbrev, ev.text FROM edition_verse ev "
                "JOIN edition e ON e.id = ev.edition_id WHERE e.language = 'grc' ORDER BY ev.vkey"
            )
        ]
        _GREEK_TEXTS[key] = rows
    return rows


def greek_text_search(s: Store, terms: list[str], limit: int, edition: str | None = None) -> list[dict[str, Any]]:
    """Verses of the Greek editions containing every term as the start of a word, accents ignored."""
    if not terms:
        return []
    hits: list[dict[str, Any]] = []
    for key, edition_id, abbrev, text, folded in _greek_texts(s):
        if edition and edition_id != edition:
            continue
        if all(f" {t}" in folded for t in terms):
            hits.append(
                {
                    "vkey": key,
                    "edition_id": edition_id,
                    "abbrev": abbrev,
                    "osis": _osis(key),
                    "snippet": _greek_snippet(text, terms),
                }
            )
            if len(hits) >= limit:
                break
    return hits


def _greek_snippet(text: str, terms: list[str], width: int = 24) -> str:
    words = text.split()
    marked = [any(normalize(w).startswith(t) for t in terms) for w in words]
    first = marked.index(True) if True in marked else 0
    lo = max(0, first - width // 3)
    hi = min(len(words), lo + width)
    out = " ".join(f"<mark>{w}</mark>" if m else w for w, m in zip(words[lo:hi], marked[lo:hi], strict=True))
    return ("…" if lo else "") + out + ("…" if hi < len(words) else "")


def resolve_ref(text: str) -> dict[str, Any] | None:
    """'jn 3:16' / 'John 3' / 'John.3.16' → first verse of the reference (or None)."""
    t = text.strip()
    r = parse_osis(t)
    if r is None:
        found = parse_refs(t)
        r = found[0] if found else None
    if r is None:
        return None
    out: dict[str, Any] = {
        "book": r.book,
        "chapter": r.c1,
        "verse": r.v1 or None,
        "label": r.label(),
        "osis": r.start_id,
    }
    if r.v1 and (r.c2 > r.c1 or r.v2 > r.v1):  # a range: the reader marks it to here (this chapter's end at most)
        out["to"] = r.v2 if r.c2 == r.c1 else 999
    return out


_LOOSE_REF = re.compile(
    r"^\s*((?:[1-4]|i{1,3}|iv)?\s*[a-z][a-z ]*?)\.?\s*(\d+)(?:\s*[:.,\s]\s*(\d+))?"  # book, chapter, verse
    r"(?:\s*[-–—]\s*(\d+)(?:\s*[:.]\s*(\d+))?)?\s*$",  # an optional range, marked in the reader
    re.I,
)


def _verse_exists(s: Store, ref: dict[str, Any]) -> bool:
    k = vkey(ref["book"], ref["chapter"], ref["verse"] or 1)
    return s.one("SELECT 1 AS x FROM verse WHERE vkey = ?", (k,)) is not None


_BARE_BOOK = re.compile(r"^\s*((?:[1-4]|i{1,3}|iv)\s*[a-z]{2,}|[a-z]{4,}(?: of [a-z]+)?)\.?\s*$", re.I)


def ref_suggestions(s: Store, q: str) -> list[dict[str, Any]]:
    """Forgiving references: 'jon 3:16', 'jhon 3 16', 'revelations 21' → the existing verses they could mean."""
    bare = _BARE_BOOK.match(q)
    if bare:  # just a book: '2 john', '1 cor', 'romans' → its first chapter (ordinary words stay searches)
        word = norm_alias(bare.group(1))
        numbered = word[:1].isdigit()
        exact = resolve_book(bare.group(1))
        if exact and (numbered or len(word) >= 4):
            found = [exact]
        elif numbered and len(word) >= 3:
            found = fuzzy_books(bare.group(1))[:2]
        else:
            found = []
        return [{"book": b, "chapter": 1, "verse": None, "osis": f"{b}.1.1", "label": BY_OSIS[b].name} for b in found]
    m = _LOOSE_REF.match(q)
    if not m:
        return []
    chapter, verse = int(m.group(2)), int(m.group(3)) if m.group(3) else None
    word = norm_alias(m.group(1))
    exact = resolve_book(m.group(1))
    # a full name ('john', 'romans') means that book; short or misspelt names ('jon', 'jhon') stay open
    books = [exact] if exact and len(word.lstrip("1234")) >= 4 else fuzzy_books(m.group(1))
    out = []
    for book in books:
        b = BY_OSIS[book]
        c, v = (1, chapter) if b.chapters == 1 and verse is None and chapter > 1 else (chapter, verse)
        if not 0 < c <= b.chapters:
            continue
        ref: dict[str, Any] = {"book": book, "chapter": c, "verse": v, "osis": f"{book}.{c}.{v or 1}"}
        ref["label"] = f"{b.name} {c}" + (f":{v}" if v else "")
        if v and m.group(4):  # 'jhon 1:2-4' marks 2–4; '1:2-2:5' marks to the chapter's end
            to = 999 if m.group(5) else int(m.group(4))
            if to > v:
                ref["to"] = to
                ref["label"] += f"–{m.group(4)}:{m.group(5)}" if m.group(5) else f"–{to}"
        if _verse_exists(s, ref):
            out.append(ref)
    return out[:4]


def pick_ref(s: Store, q: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """The reference a query most likely means, and the other existing verses it could mean.
    Loose input ('jon 3:16', '1 jon 1:9', 'jhon 1:2-4') is ranked by the forgiving matcher; anything it
    does not cover ('Rom 8:28; 12:1', 'John.3.16') by the strict parser. Verses that do not exist never win."""
    alts = ref_suggestions(s, q)
    strict = resolve_ref(q)
    if strict and not _verse_exists(s, strict):  # 'jon 3:16' parses as Jonah 3:16, which does not exist
        strict = None
    if not alts:
        return strict, []
    same = strict and all(strict[k] == alts[0][k] for k in ("book", "chapter", "verse"))
    first = strict if strict and same else alts[0]  # keeps a range's label
    return first, alts[1:]


@router.get("/resolve")
def resolve(request: Request, q: str = Query(..., max_length=100)) -> dict[str, Any]:
    """A reference to jump to: exact when it exists; a misspelt book only when there is one sensible reading
    ('revelations 21'). Ambiguous ('jon 3:5' — John or Jonah?) → 404, and the search page offers the choices."""
    ref, alts = pick_ref(store(request), q)
    if ref and not alts:
        return ref
    raise HTTPException(404, "not a single Bible reference")


__all__ = ["BOOKS", "router"]
