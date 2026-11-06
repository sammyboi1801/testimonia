"""Study tools over a whole passage or the whole corpus: the passage guide, grammar search and word charts.

Read-only like api.py, and built on its helpers (store, _osis); everything here is computed from core.db as it is.
"""

from __future__ import annotations

import re
import threading
import unicodedata
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from .. import morphology
from ..books import BY_OSIS
from ..ingest.stepbible import normalize
from ..refs import key_to_parts, parse_osis, parse_refs
from .api import OUTSIDE, _osis, store
from .store import Store

router = APIRouter(prefix="/api")

MAX_PASSAGE = 250  # verses in one passage guide
MAX_CITATION_SPAN = 40  # citations of whole chapters/books are not counted for a short passage
SIGNIFICANT = ("meaning", "omission", "ketiv-qere")
EDITION_OF = {"grc": "tagnt", "hbo": "tahot"}  # the word editions (see api.WORD_EDITIONS)


def _label(lo: int, hi: int) -> str:
    """'John 1:1–18', 'John 1:1–2:11', 'John 3:16'."""
    b1, c1, v1 = key_to_parts(lo)
    b2, c2, v2 = key_to_parts(hi)
    name = BY_OSIS[b1].name
    if (b1, c1, v1) == (b2, c2, v2):
        return f"{name} {c1}:{v1}"
    if b1 == b2 and c1 == c2:
        return f"{name} {c1}:{v1}–{v2}"
    if b1 == b2:
        return f"{name} {c1}:{v1}–{c2}:{v2}"
    return f"{name} {c1}:{v1} – {BY_OSIS[b2].name} {c2}:{v2}"


def _texts(s: Store, keys: list[int], edition: str) -> dict[int, str]:
    """One translation's text for many verses (falling back to KJV, then WEB, where that edition lacks one)."""
    if not keys:
        return {}
    out: dict[int, str] = {}
    for ed in (edition, "kjva", "web"):
        missing = [k for k in keys if k not in out]
        if not missing:
            break
        marks = ",".join("?" * len(missing))
        for r in s.all(
            f"SELECT vkey, text FROM edition_verse WHERE edition_id = ? AND vkey IN ({marks})", (ed, *missing)
        ):
            out[r["vkey"]] = r["text"]
    return out


# ----------------------------------------------------------------------------- passage guide


def _resolve_passage(s: Store, ref: str) -> tuple[int, int]:
    r = parse_osis(ref)
    if r is None:
        found = parse_refs(ref)
        r = found[0] if found else None
    if r is None:
        raise HTTPException(404, f"not a Bible passage: {ref!r}")
    lo, hi = r.start, r.end
    if lo == hi:  # one verse: the section (pericope) it belongs to
        h = s.one(
            "SELECT start_vkey, end_vkey FROM heading WHERE scheme = 'btb-pericope' AND start_vkey <= ? "
            "AND end_vkey >= ? ORDER BY start_vkey DESC LIMIT 1",
            (lo, lo),
        )
        if h:
            lo, hi = h["start_vkey"], h["end_vkey"]
    return lo, hi


@router.get("/passage/{ref}")
def passage(
    request: Request,
    ref: str,
    edition: str = Query("bsb", max_length=40),
    limit: int = Query(40, ge=1, le=200),
) -> dict[str, Any]:
    """Everything about a range of verses at once: text, variants, the fathers who quote it, links, notes, topics."""
    s = store(request)
    lo, hi = _resolve_passage(s, ref)
    verses = s.all(
        "SELECT vkey, osis, chapter, verse FROM verse WHERE vkey BETWEEN ? AND ? AND verse > 0 ORDER BY vkey", (lo, hi)
    )
    if not verses:
        raise HTTPException(404, f"no verses in {ref!r}")
    if len(verses) > MAX_PASSAGE:
        raise HTTPException(400, f"passage too long: at most {MAX_PASSAGE} verses")
    lo, hi = verses[0]["vkey"], verses[-1]["vkey"]
    book, chapter, _ = key_to_parts(lo)
    book_lo = lo - lo % 1_000_000
    keys = [v["vkey"] for v in verses]
    texts = _texts(s, keys, edition)
    for v in verses:
        v["text"] = texts.get(v["vkey"])
    abbrev = s.scalar("SELECT abbrev FROM edition WHERE id = ?", (edition,))

    headings = s.all(
        "SELECT title, start_vkey, end_vkey FROM heading WHERE scheme = 'btb-pericope' AND start_vkey BETWEEN ? AND ? "
        "AND end_vkey >= ? ORDER BY start_vkey",
        (book_lo, hi, lo),
    )
    for h in headings:
        h["osis"] = _osis(max(h["start_vkey"], lo))
    prev = s.one(
        "SELECT title, start_vkey, end_vkey FROM heading WHERE scheme = 'btb-pericope' AND start_vkey BETWEEN ? AND ? "
        "ORDER BY start_vkey DESC LIMIT 1",
        (book_lo, lo - 1),
    )
    nxt = s.one(
        "SELECT title, start_vkey, end_vkey FROM heading WHERE scheme = 'btb-pericope' AND start_vkey > ? "
        "AND start_vkey < ? ORDER BY start_vkey LIMIT 1",
        (hi, book_lo + 1_000_000),
    )

    def section(h: dict[str, Any] | None) -> dict[str, Any] | None:
        if h is None:
            return None
        return {"title": h["title"], "ref": f"{_osis(h['start_vkey'])}-{_osis(h['end_vkey'])}"}

    return {
        "range": {
            "ref": f"{_osis(lo)}-{_osis(hi)}",
            "start": _osis(lo),
            "end": _osis(hi),
            "label": _label(lo, hi),
            "book": book,
            "name": BY_OSIS[book].name,
            "testament": BY_OSIS[book].testament,
            "chapter": chapter,
        },
        "edition": {"id": edition, "abbrev": abbrev},
        "verses": verses,
        "headings": headings,
        "prev": section(prev),
        "next": section(nxt),
        "variants": _passage_variants(s, lo, hi),
        **_passage_writers(s, book_lo, lo, hi),
        "crossrefs": _passage_crossrefs(s, lo, hi, edition, limit),
        "quotations": _passage_quotations(s, lo, hi, edition),
        "topics": s.all(
            "SELECT t.id, t.name, count(*) AS n FROM topic_ref r JOIN topic t ON t.id = r.topic_id "
            "WHERE r.start_vkey BETWEEN ? AND ? GROUP BY t.id ORDER BY n DESC, t.name LIMIT 40",
            (lo, hi),
        ),
        "footnotes": [
            {**f, "osis": _osis(f["vkey"])}
            for f in s.all(
                "SELECT n.vkey, n.edition_id, e.abbrev, e.language, n.n, n.kind, n.body, n.anchor FROM edition_note n "
                "JOIN edition e ON e.id = n.edition_id WHERE n.vkey BETWEEN ? AND ? "
                "ORDER BY n.vkey, e.sort, n.n LIMIT 600",
                (lo, hi),
            )
        ],
        "chronology": _passage_chronology(s, lo, hi),
        "periods": s.all(
            "SELECT p.id, p.name, p.parent_id, min(vp.vkey) AS first FROM verse_period vp "
            "JOIN period p ON p.id = vp.period_id WHERE vp.vkey BETWEEN ? AND ? GROUP BY p.id "
            "ORDER BY p.parent_id IS NOT NULL, first",
            (lo, hi),
        ),
    }


def _passage_variants(s: Store, lo: int, hi: int) -> list[dict[str, Any]]:
    units = s.all(
        "SELECT id, start_vkey, label, significance, note FROM variant_unit WHERE start_vkey BETWEEN ? AND ? "
        "ORDER BY start_vkey, id",
        (lo, hi),
    )
    if not units:
        return []
    by_id = {u["id"]: {**u, "osis": _osis(u["start_vkey"]), "readings": []} for u in units}
    marks = ",".join("?" * len(by_id))
    for r in s.all(
        "SELECT r.unit_id, r.n, r.text, r.gloss, group_concat(w.witness_type || ':' || w.witness_id "
        "|| coalesce(':' || w.qualifier, ''), ' ') AS witnesses FROM variant_reading r "
        f"LEFT JOIN variant_witness w ON w.unit_id = r.unit_id AND w.n = r.n WHERE r.unit_id IN ({marks}) "
        "GROUP BY r.unit_id, r.n ORDER BY r.unit_id, r.n",
        tuple(by_id),
    ):
        by_id[r.pop("unit_id")]["readings"].append(r)
    rank = {k: i for i, k in enumerate(SIGNIFICANT)}
    return sorted(by_id.values(), key=lambda u: (u["start_vkey"], rank.get(u["significance"], 9), u["id"]))


def _passage_writers(s: Store, book_lo: int, lo: int, hi: int) -> dict[str, list[dict[str, Any]]]:
    """Church fathers (and, apart, Jewish and Roman writers) who cite any verse of the passage, one entry per writer."""
    span = max(MAX_CITATION_SPAN, hi - lo)
    rows = s.all(
        "SELECT c.start_vkey, c.end_vkey, c.work_id, w.title AS work_title, w.category, w.era, c.author_id, "
        "p.name AS author, c.year, c.kind, c.cite, c.snippet, c.edition_id, c.section_ord FROM citation c "
        "JOIN work w ON w.id = c.work_id LEFT JOIN person p ON p.id = c.author_id "
        "WHERE c.start_vkey BETWEEN ? AND ? AND c.end_vkey >= ? AND c.end_vkey - c.start_vkey <= ? "
        "ORDER BY c.year IS NULL, c.year, c.start_vkey",
        (book_lo, hi, lo, span),
    )
    writers: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = r["author_id"] or f"work:{r['work_id']}"
        w = writers.get(key)
        if w is None:
            w = writers[key] = {
                "id": key,
                "author_id": r["author_id"],
                "name": r["author"] or r["work_title"],
                "year": r["year"],
                "era": r["era"],
                "category": r["category"],
                "outside": r["category"] in OUTSIDE,
                "n": 0,
                "verses": set(),
                "works": {},
            }
        w["n"] += 1
        if w["year"] is None or (r["year"] is not None and r["year"] < w["year"]):
            w["year"] = r["year"]
        w["verses"].add(max(r["start_vkey"], lo))
        place = (r["work_id"], r["edition_id"], r["section_ord"], r["cite"])
        item = w["works"].get(place)
        if item is None:
            w["works"][place] = {
                k: r[k] for k in ("work_id", "work_title", "cite", "edition_id", "section_ord", "kind", "snippet")
            } | {"osis": _osis(max(r["start_vkey"], lo)), "times": 1}
        else:
            item["times"] += 1
    out: list[dict[str, Any]] = []
    for w in writers.values():
        pre = (w["year"] is not None and w["year"] <= 325) or w["era"] in ("apostolic", "ante-nicene")
        works = list(w["works"].values())
        out.append(
            {
                **w,
                "pre_nicene": pre,
                "verses": [_osis(k) for k in sorted(w["verses"])],
                "places": len(works),
                "works": works[:12],
            }
        )
    out.sort(key=lambda w: (not w["pre_nicene"], w["year"] is None, w["year"] or 0, -w["n"]))
    return {"fathers": [w for w in out if not w["outside"]], "witnesses": [w for w in out if w["outside"]]}


def _passage_crossrefs(s: Store, lo: int, hi: int, edition: str, limit: int) -> list[dict[str, Any]]:
    merged: dict[tuple[int, int], dict[str, Any]] = {}
    for r in s.all(
        "SELECT src_start, dst_start, dst_end, votes FROM crossref WHERE src_start BETWEEN ? AND ?", (lo, hi)
    ):
        if lo <= r["dst_start"] <= hi:  # a link within the passage itself
            continue
        key = (r["dst_start"], r["dst_end"])
        m = merged.get(key)
        if m is None:
            merged[key] = {**r, "votes": r["votes"] or 0, "from": {r["src_start"]}}
        else:
            m["votes"] = max(m["votes"], r["votes"] or 0)
            m["from"].add(r["src_start"])
    # the same verse reached from several verses of the passage ranks higher
    best = sorted(merged.values(), key=lambda x: (-(x["votes"] * (1 + 0.25 * (len(x["from"]) - 1))), x["dst_start"]))
    best = best[:limit]
    texts = _texts(s, [x["dst_start"] for x in best], edition)
    return [
        {
            "osis": _osis(x["dst_start"]),
            "end_osis": _osis(x["dst_end"]) if x["dst_end"] != x["dst_start"] else None,
            "votes": x["votes"],
            "from": [_osis(k) for k in sorted(x["from"])],
            "text": texts.get(x["dst_start"]),
        }
        for x in best
    ]


def _passage_quotations(s: Store, lo: int, hi: int, edition: str) -> list[dict[str, Any]]:
    rows = s.all(
        "SELECT 'quotes' AS direction, src_start AS here, dst_start AS other, kind, via FROM quotation "
        "WHERE src_start BETWEEN ? AND ? UNION "
        "SELECT 'quoted_by', dst_start, src_start, kind, via FROM quotation WHERE dst_start BETWEEN ? AND ? "
        "ORDER BY 2, 3",
        (lo, hi, lo, hi),
    )
    texts = _texts(s, [r["other"] for r in rows], edition)
    for r in rows:
        r["text"] = texts.get(r["other"])
        r["here"], r["other"] = _osis(r["here"]), _osis(r["other"])
    return rows


def _passage_chronology(s: Store, lo: int, hi: int) -> dict[str, Any] | None:
    rows = s.all(
        "SELECT label, min(start_year) AS start_year, max(end_year) AS end_year, min(vkey) AS first FROM verse_date "
        "WHERE vkey BETWEEN ? AND ? GROUP BY label ORDER BY first",
        (lo, hi),
    )
    if not rows:
        return None
    starts = [r["start_year"] for r in rows if r["start_year"] is not None]
    ends = [r["end_year"] for r in rows if r["end_year"] is not None]
    return {
        "labels": [r["label"] for r in rows if r["label"]][:4],
        "start_year": min(starts) if starts else None,
        "end_year": max(ends) if ends else None,
    }


# ----------------------------------------------------------------------------- grammar search

_cache_lock = threading.Lock()
_codes: dict[tuple[str, str], list[str]] = {}
_lemmas: dict[tuple[str, str], list[tuple[str, str, str]]] = {}
STRONG = re.compile(r"^([GH])0*(\d{1,4})([A-Za-z]?)$")
GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
HEBREW = re.compile(r"[֐-׿]")
FEATURE_PARAMS = ("part", "tense", "voice", "mood", "case", "person", "number", "gender", "stem", "form", "state")


def _morph_codes(s: Store, edition: str) -> list[str]:
    """Every distinct morphology code in a word edition (read once per database)."""
    key = (str(s.path), edition)
    with _cache_lock:
        if key not in _codes:
            _codes[key] = [
                r["morph"]
                for r in s.all(
                    "SELECT DISTINCT morph FROM token WHERE edition_id = ? AND morph IS NOT NULL", (edition,)
                )
            ]
        return _codes[key]


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).lower().strip()


def _find_lemmas(s: Store, q: str, lang: str) -> list[str]:
    """'λύω' / 'luo' / 'G3089' → lemma ids (accents, vowel points and case ignored)."""
    m = STRONG.match(q.strip())
    if m:
        return [f"{m.group(1).upper()}{int(m.group(2)):04d}{m.group(3)}"]
    key = (str(s.path), lang)
    with _cache_lock:
        if key not in _lemmas:
            langs = ("grc",) if lang == "grc" else ("hbo", "arc")
            marks = ",".join("?" * len(langs))
            _lemmas[key] = [
                (r["id"], normalize(r["lemma"] or ""), _fold(r["translit"] or ""))
                for r in s.all(f"SELECT id, lemma, translit FROM lemma WHERE language IN ({marks})", langs)
            ]
    want, folded = normalize(q), _fold(q)
    return [i for i, lem, tr in _lemmas[key] if (want and lem == want) or (folded and tr == folded)]


def _articular(word: dict[str, str], m1: str | None, m2: str | None) -> bool:
    """Greek: is the word preceded by its article? ('ὁ θεός', 'ὁ γὰρ θεός', 'τὸν μονογενῆ θεόν')"""

    def agrees(m: str | None) -> bool:
        f = morphology.parse(m)
        if f.get("part") != "article":
            return False
        return all(f.get(k) == word[k] for k in ("case", "number") if k in word and k in f)

    if agrees(m1):
        return True
    between = morphology.parse(m1).get("part")
    return between in ("particle", "conjunction", "adjective") and agrees(m2)


@router.get("/grammar")
def grammar(
    request: Request,
    lemma: str | None = Query(None, max_length=60),
    strong: str | None = Query(None, max_length=8),
    lang: str | None = Query(None, pattern="^(grc|hbo)$"),
    book: str | None = Query(None, max_length=8),
    part: str | None = None,
    tense: str | None = None,
    voice: str | None = None,
    mood: str | None = None,
    case: str | None = None,
    person: str | None = None,
    number: str | None = None,
    gender: str | None = None,
    stem: str | None = None,
    form: str | None = None,
    state: str | None = None,
    article: str | None = Query(None, pattern="^(with|without)$"),
    no_article: bool = False,
    edition: str = Query("bsb", max_length=40),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict[str, Any]:
    """Words of the Greek NT or Hebrew OT by lemma and grammatical form, e.g. every aorist passive of λύω,
    or every θεός without the article in John. Results are verses (paged), each with the matching words marked."""
    s = store(request)
    word = (strong or lemma or "").strip()
    if word[:1] in ("G", "H") and STRONG.match(word):
        language = "grc" if word[0] == "G" else "hbo"
    elif GREEK.search(word):
        language = "grc"
    elif HEBREW.search(word):
        language = "hbo"
    elif lang:
        language = lang
    elif book in BY_OSIS and BY_OSIS[book].testament == "OT":
        language = "hbo"
    else:
        language = "grc"
    edition_id = EDITION_OF[language]
    allowed = morphology.FEATURES[language]
    given = dict(
        zip(FEATURE_PARAMS, (part, tense, voice, mood, case, person, number, gender, stem, form, state), strict=True)
    )
    wanted: dict[str, str] = {}
    for k, v in given.items():
        if not v:
            continue
        if k not in allowed or v not in allowed[k]:
            raise HTTPException(400, f"unknown {k} {v!r} for {'Greek' if language == 'grc' else 'Hebrew'}")
        wanted[k] = v
    article = "without" if no_article else article
    if book is not None and book not in BY_OSIS:
        raise HTTPException(404, f"unknown book {book!r}")

    lemma_ids = _find_lemmas(s, word, language) if word else []
    lemmas = []
    if lemma_ids:
        marks = ",".join("?" * len(lemma_ids))
        lemmas = s.all(f"SELECT id, lemma, translit, gloss FROM lemma WHERE id IN ({marks}) ORDER BY id", lemma_ids)
    out: dict[str, Any] = {
        "language": language,
        "query": {"word": word or None, "book": book, **wanted, "article": article},
        "lemmas": lemmas,
        "total": 0,
        "verses": 0,
        "page": page,
        "size": size,
        "by_book": [],
        "results": [],
    }
    if word and not lemma_ids:
        out["message"] = f"No {'Greek' if language == 'grc' else 'Hebrew'} word matches {word!r}."
        return out
    if not lemma_ids and not wanted and not article:
        raise HTTPException(400, "choose a word, or at least one grammatical feature")

    where = ["t.edition_id = ?"]
    params: list[Any] = [edition_id]
    if lemma_ids:
        ors = []
        for i in lemma_ids:
            if i[-1].isalpha():  # an extended Strong's number names one exact lemma
                ors.append("t.lemma_id = ?")
                params.append(i)
            else:  # G3089 / H1254 also covers H1254A, H1254B…
                ors.append("t.lemma_id BETWEEN ? AND ?")
                params += [i, i + "z"]
        where.append(f"({' OR '.join(ors)})")
    if book:
        lo = BY_OSIS[book].order * 1_000_000
        where.append("t.vkey BETWEEN ? AND ?")
        params += [lo, lo + 999_999]
    hebrew_article = language == "hbo" and article
    if wanted or hebrew_article:
        codes = [
            c
            for c in _morph_codes(s, edition_id)
            if morphology.matches(c, wanted)
            and (not hebrew_article or (morphology.parse(c).get("article") == "yes") == (article == "with"))
        ]
        if not codes:
            return out
        where.append(f"t.morph IN ({','.join('?' * len(codes))})")
        params += codes
    greek_article = language == "grc" and article
    joins = (
        "LEFT JOIN token p1 ON p1.edition_id = t.edition_id AND p1.vkey = t.vkey AND p1.pos = t.pos - 1 "
        "LEFT JOIN token p2 ON p2.edition_id = t.edition_id AND p2.vkey = t.vkey AND p2.pos = t.pos - 2 "
        if greek_article
        else ""
    )
    rows = s.all(
        f"SELECT t.vkey, t.pos, t.morph{', p1.morph AS m1, p2.morph AS m2' if greek_article else ''} FROM token t "
        f"{joins}WHERE {' AND '.join(where)} ORDER BY t.vkey, t.pos",
        params,
    )
    if greek_article:
        rows = [r for r in rows if _articular(morphology.parse(r["morph"]), r["m1"], r["m2"]) == (article == "with")]

    verses: dict[int, list[int]] = {}
    counts: dict[str, int] = {}
    for r in rows:
        verses.setdefault(r["vkey"], []).append(r["pos"])
        b = key_to_parts(r["vkey"])[0]
        counts[b] = counts.get(b, 0) + 1
    out["total"] = len(rows)
    out["verses"] = len(verses)
    out["by_book"] = [
        {"book": b, "name": BY_OSIS[b].name, "n": n}
        for b, n in sorted(counts.items(), key=lambda x: BY_OSIS[x[0]].order)
    ]
    keys = list(verses)[(page - 1) * size : page * size]
    if not keys:
        return out
    marks = ",".join("?" * len(keys))
    words: dict[int, list[dict[str, Any]]] = {}
    for w in s.all(
        "SELECT t.vkey, t.pos, t.surface, t.lemma_id, t.morph, t.gloss, t.editions FROM token t "
        f"WHERE t.edition_id = ? AND t.vkey IN ({marks}) ORDER BY t.vkey, t.pos",
        (edition_id, *keys),
    ):
        hit = w["pos"] in verses[w["vkey"]]
        # NT: the running text is the SBL edition's; words found only in other editions are shown when they match
        if not hit and w["editions"] and "SBL" not in w["editions"].split("+"):
            continue
        entry: dict[str, Any] = {"pos": w["pos"], "surface": w["surface"]}
        if hit:
            only = w["editions"] if w["editions"] and "NA28" not in w["editions"].split("+") else None
            entry |= {
                "hit": True,
                "lemma_id": w["lemma_id"],
                "morph": w["morph"],
                "parse": morphology.describe(w["morph"]),
                "gloss": w["gloss"],
                "only_in": only.replace("+", ", ") if only else None,
            }
        words.setdefault(w["vkey"], []).append(entry)
    texts = _texts(s, keys, edition)
    out["results"] = [
        {"osis": _osis(k), "book": key_to_parts(k)[0], "words": words.get(k, []), "text": texts.get(k)} for k in keys
    ]
    return out


# ----------------------------------------------------------------------------- word charts


def _check_strong(strong: str) -> None:
    if not re.match(r"^[GH]\d{4}[A-Za-z]?$", strong):
        raise HTTPException(400, "expected an extended Strong's number such as G3439 or H0430G")


@router.get("/word/{strong}/chapters")
def word_chapters(request: Request, strong: str, limit: int = Query(8, ge=1, le=50)) -> dict[str, Any]:
    """Where a word clusters: the chapters that use it most."""
    _check_strong(strong)
    rows = store(request).all(
        "SELECT t.vkey / 1000 AS ch, count(*) AS n FROM token t WHERE t.lemma_id = ? GROUP BY ch "
        "ORDER BY n DESC, ch LIMIT ?",
        (strong, limit),
    )
    out = []
    for r in rows:
        b, c, _ = key_to_parts(r["ch"] * 1000)
        out.append({"book": b, "name": BY_OSIS[b].name, "chapter": c, "n": r["n"]})
    return {"chapters": out}


@router.get("/word/{strong}/book/{book}")
def word_in_book(
    request: Request, strong: str, book: str, limit: int = Query(500, ge=1, le=3000)
) -> list[dict[str, Any]]:
    """Every occurrence of a word in one book (the chart's bars link here)."""
    _check_strong(strong)
    if book not in BY_OSIS:
        raise HTTPException(404, f"unknown book {book!r}")
    lo = BY_OSIS[book].order * 1_000_000
    rows = store(request).all(
        "SELECT t.vkey, t.surface, t.gloss, t.morph, t.edition_id FROM token t WHERE t.lemma_id = ? "
        "AND t.vkey BETWEEN ? AND ? ORDER BY t.vkey, t.pos LIMIT ?",
        (strong, lo, lo + 999_999, limit),
    )
    for r in rows:
        r["osis"] = _osis(r["vkey"])
    return rows
