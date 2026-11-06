"""JSON API for the Testimonia app (read-only over core.db).

Every endpoint is a plain, typed function; FastAPI runs them in a worker thread pool and each worker
uses its own read-only SQLite connection (see store.py).
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..books import BOOKS, BY_OSIS
from ..ingest.stepbible import normalize
from ..refs import id_to_key, key_to_parts, parse_osis, parse_refs, vkey
from .store import Store

router = APIRouter(prefix="/api")

LEXICON_ORDER = ["tbesg", "tbesh", "abbott-smith", "lsj", "bdb"]
WORD_EDITIONS = {"tagnt": "NT", "tahot": "OT"}  # word-data editions (rendered as interlinear)


def store(request: Request) -> Store:
    s: Store = request.app.state.store
    return s


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
        "FROM edition ORDER BY sort, id"
    )
    present = {
        r["book"]: r["chapters"] for r in s.all("SELECT book, max(chapter) AS chapters FROM verse GROUP BY book")
    }
    books = [
        {**r, "chapters": present[r["osis"]]}
        for r in s.all(
            "SELECT osis, name, testament, hebrew_name, greek_name, latin_name, genre, ord FROM book ORDER BY ord"
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
    for ed in (e for e in wanted if e in WORD_EDITIONS):
        for r in s.all(
            "SELECT vkey, pos, surface, translit, gloss, strong, lemma_id, morph, editions, word_type "
            "FROM token WHERE edition_id = ? AND vkey BETWEEN ? AND ? ORDER BY vkey, pos",
            (ed, lo, hi),
        ):
            if r["vkey"] in by_key:
                by_key[r.pop("vkey")]["words"].setdefault(ed, []).append(r)
    headings = s.all(
        "SELECT start_vkey AS vkey, title FROM heading WHERE scheme = 'btb-pericope' "
        "AND start_vkey BETWEEN ? AND ? ORDER BY start_vkey",
        (lo, hi),
    )
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
        "JOIN edition e ON e.id = ev.edition_id WHERE ev.vkey = ? ORDER BY e.sort",
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
        "c.cite, c.snippet, c.edition_id, c.section_ord, c.source_id FROM citation c "
        "JOIN work w ON w.id = c.work_id LEFT JOIN person p ON p.id = c.author_id "
        "WHERE c.start_vkey BETWEEN ? AND ? AND c.end_vkey >= ? ORDER BY c.year IS NULL, c.year, w.title LIMIT ?",
        (book_lo, k, k, limit * 4),
    )
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for f in fathers:
        key = (f["work_id"], f["edition_id"], f["section_ord"])
        if key in merged:
            merged[key]["times"] += 1
        else:
            merged[key] = {**f, "times": 1}
    fathers = list(merged.values())
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
    return {
        "verse": v,
        "texts": texts,
        "words": words,
        "variants": variants,
        "crossrefs": xrefs,
        "quotations": quotes,
        "fathers": fathers,
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


@router.get("/works")
def works(request: Request) -> list[dict[str, Any]]:
    return store(request).all(
        "SELECT w.id, w.title, w.category, w.era, w.author_id, p.name AS author, p.floruit_to AS year, "
        "(SELECT count(*) FROM citation c WHERE c.work_id = w.id) AS citations, "
        "(SELECT min(id) FROM work_edition we WHERE we.work_id = w.id) AS edition_id "
        "FROM work w LEFT JOIN person p ON p.id = w.author_id "
        "ORDER BY p.floruit_to IS NULL, p.floruit_to, p.name, w.title"
    )


@router.get("/edition/{edition_id}/toc")
def toc(request: Request, edition_id: str) -> dict[str, Any]:
    s = store(request)
    ed = s.one(
        "SELECT we.*, w.title, w.category, w.era, p.name AS author FROM work_edition we JOIN work w ON w.id = "
        "we.work_id LEFT JOIN person p ON p.id = w.author_id WHERE we.id = ?",
        (edition_id,),
    )
    if ed is None:
        raise HTTPException(404, "unknown edition")
    sections = s.all(
        "SELECT ord, cite, title, level FROM work_section WHERE edition_id = ? ORDER BY ord", (edition_id,)
    )
    return {"edition": ed, "sections": sections}


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
    ref = resolve_ref(q)
    if ref:
        out["reference"] = ref
    if ORIGINAL_SCRIPT.search(q):
        out.update(original_language_search(s, q, limit))
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


def resolve_ref(text: str) -> dict[str, Any] | None:
    """'jn 3:16' / 'John 3' / 'John.3.16' → first verse of the reference (or None)."""
    t = text.strip()
    r = parse_osis(t)
    if r is None:
        found = parse_refs(t)
        r = found[0] if found else None
    if r is None:
        return None
    return {"book": r.book, "chapter": r.c1, "verse": r.v1 or None, "label": r.label(), "osis": r.start_id}


@router.get("/resolve")
def resolve(q: str = Query(..., max_length=100)) -> dict[str, Any]:
    ref = resolve_ref(q)
    if ref is None:
        raise HTTPException(404, "not a Bible reference")
    return ref


__all__ = ["BOOKS", "router"]
