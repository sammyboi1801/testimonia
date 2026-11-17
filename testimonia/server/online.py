"""Sources looked up live, beyond the library: modern scholarship (OpenAlex), Jewish readers of the Hebrew Bible
(Sefaria) and art (Wikimedia Commons). Nothing about the reader is sent: only a passage or a search phrase.

Each answer is kept for a week (a failure for ten minutes), at most a few lookups run at once so the small server
stays responsive, and a visitor can start only so many new lookups a minute. When a source cannot be reached the
answer is simply empty, and the page leaves that section out.
"""

from __future__ import annotations

import html
import re
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from .api import _verse_key, store

router = APIRouter(prefix="/api/online")

#: a generic client name, as the sources ask; no personal details
HEADERS = {"User-Agent": "Testimonia/0.1 (open-source Bible study; https://github.com/sammyboi1801/testimonia)"}
WEEK = 7 * 24 * 3600
_cache: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_cache_lock = threading.Lock()
_outbound = threading.BoundedSemaphore(4)  # lookups in flight at once, across all visitors
_HITS: dict[str, deque[float]] = {}
RATE = (120, 60.0)  # new (uncached) lookups per address per minute (readers via the site share the proxy's)

#: licences under which a text or image may be shown here (with its credit)
OPEN = {"public domain", "pd", "cc0", "cc-by", "cc-by-sa", "cc by", "cc by-sa", "cc by 2.0", "cc by-sa 2.0"}


def _open_licence(name: str | None) -> bool:
    n = (name or "").strip().lower()
    if not n:
        return False
    if n in OPEN or n.startswith(("public domain", "pd-", "cc0")):
        return True
    # "CC BY 4.0", "CC BY-SA 3.0", "CC-BY-SA": attribution (and share-alike) only, no non-commercial or no-derivatives
    return bool(re.match(r"^cc[ -]by(?:[ -]sa)?(?:[ -][\d.]+)?$", n))


def _cached(key: str, fetch: Callable[[], Any], request: Request | None = None) -> Any:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            _cache.move_to_end(key)
            return hit[1]
    if request is not None:
        _rate_limit(request)
    try:
        with _outbound:
            value, ttl = fetch(), WEEK
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        value, ttl = None, 600
    with _cache_lock:
        _cache[key] = (now + ttl, value)
        while len(_cache) > 3000:
            _cache.popitem(last=False)
    return value


def _rate_limit(request: Request) -> None:
    ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    ip = ip or (request.client.host if request.client else "?")
    now = time.monotonic()
    hits = _HITS.setdefault(ip, deque())
    while hits and now - hits[0] > RATE[1]:
        hits.popleft()
    if len(hits) >= RATE[0]:
        raise HTTPException(429, "Too many lookups in a short time; wait a minute.")
    hits.append(now)
    if len(_HITS) > 10_000:
        for k in [k for k, v in _HITS.items() if not v or now - v[-1] > RATE[1]]:
            del _HITS[k]


def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(8.0), headers=HEADERS, follow_redirects=True)


_TAGS = re.compile(r"<[^>]+>")


def _plain(s: str | None) -> str:
    return " ".join(html.unescape(_TAGS.sub(" ", s or "")).split())


# ----------------------------------------------------------------------------- OpenAlex: modern scholarship


def scholarship(query: str) -> list[dict[str, Any]] | None:
    """Scholarly works on a passage or question, most relevant first (Arts & Humanities only)."""
    q = " ".join(query.split())[:200]
    if not q:
        return []

    def fetch() -> list[dict[str, Any]]:
        with _client() as http:
            r = http.get(
                "https://api.openalex.org/works",
                params={
                    "search": q,
                    "filter": "primary_topic.field.id:12",
                    "per-page": 8,
                    "select": "id,display_name,publication_year,doi,cited_by_count,open_access,authorships,"
                    "primary_location,abstract_inverted_index,type",
                },
            )
            r.raise_for_status()
            out = []
            for w in r.json().get("results", []):
                loc = w.get("primary_location") or {}
                oa = w.get("open_access") or {}
                out.append(
                    {
                        "title": _plain(w.get("display_name")),
                        "year": w.get("publication_year"),
                        "authors": [
                            (a.get("author") or {}).get("display_name")
                            for a in (w.get("authorships") or [])[:3]
                            if (a.get("author") or {}).get("display_name")
                        ],
                        "more_authors": max(0, len(w.get("authorships") or []) - 3),
                        "venue": ((loc.get("source") or {}).get("display_name")),
                        "type": w.get("type"),
                        "cited_by": w.get("cited_by_count") or 0,
                        "url": w.get("doi") or loc.get("landing_page_url") or w.get("id"),
                        "free_url": oa.get("oa_url") if oa.get("is_oa") else None,
                        "abstract": _abstract(w.get("abstract_inverted_index"))[:700],
                    }
                )
            return [w for w in out if _real_title(w["title"])]

    return _cached(f"oa:{q.lower()}", fetch)


def _real_title(t: str) -> bool:
    """A work's title, not a file name ('nvt_ct03') or a lone word ('Nicodemus.') the index picked up."""
    return len(t.split()) >= 3 and "_" not in t


def _abstract(inverted: dict[str, list[int]] | None) -> str:
    """OpenAlex keeps abstracts as word → positions; put the words back in order."""
    if not inverted:
        return ""
    at: dict[int, str] = {}
    for word, places in inverted.items():
        for p in places:
            at[p] = word
    return " ".join(at[i] for i in sorted(at))


# ----------------------------------------------------------------------------- Sefaria: Jewish readers

#: OSIS book → Sefaria's title (the Hebrew Bible only; Sefaria has no New Testament)
SEFARIA_BOOKS = {
    "Gen": "Genesis", "Exod": "Exodus", "Lev": "Leviticus", "Num": "Numbers", "Deut": "Deuteronomy",
    "Josh": "Joshua", "Judg": "Judges", "Ruth": "Ruth", "1Sam": "I Samuel", "2Sam": "II Samuel",
    "1Kgs": "I Kings", "2Kgs": "II Kings", "1Chr": "I Chronicles", "2Chr": "II Chronicles", "Ezra": "Ezra",
    "Neh": "Nehemiah", "Esth": "Esther", "Job": "Job", "Ps": "Psalms", "Prov": "Proverbs",
    "Eccl": "Ecclesiastes", "Song": "Song of Songs", "Isa": "Isaiah", "Jer": "Jeremiah", "Lam": "Lamentations",
    "Ezek": "Ezekiel", "Dan": "Daniel", "Hos": "Hosea", "Joel": "Joel", "Amos": "Amos", "Obad": "Obadiah",
    "Jonah": "Jonah", "Mic": "Micah", "Nah": "Nahum", "Hab": "Habakkuk", "Zeph": "Zephaniah", "Hag": "Haggai",
    "Zech": "Zechariah", "Mal": "Malachi",
}  # fmt: skip
#: the kinds of writing shown, in this order; Kabbalah, Chasidut, modern essays and reference works are left out
KINDS = ["Targum", "Mishnah", "Talmud", "Midrash", "Commentary"]


def sefaria_ref(s: Any, osis: str) -> str | None:
    """'Ps.51.1' → 'Psalms 51:3': Sefaria numbers verses as the Hebrew Bible does (Psalm titles count)."""
    book = osis.split(".")[0]
    if book not in SEFARIA_BOOKS:
        return None
    try:
        k = _verse_key(osis)
    except HTTPException:
        return None
    row = s.one("SELECT native_ref FROM edition_verse WHERE vkey = ? AND edition_id = 'wlc'", (k,))
    native = (row or {}).get("native_ref") or osis
    parts = native.split(".")
    if len(parts) != 3 or parts[0] not in SEFARIA_BOOKS:
        return None
    return f"{SEFARIA_BOOKS[parts[0]]} {parts[1]}:{parts[2]}"


def jewish(s: Any, osis: str) -> dict[str, Any] | None:
    """The Jewish writings Sefaria links to a verse: grouped, oldest first, quoted when openly licensed."""
    ref = sefaria_ref(s, osis)
    if ref is None:
        return {"ref": None, "sources": []}

    def fetch() -> dict[str, Any]:
        with _client() as http:
            r = http.get(f"https://www.sefaria.org/api/links/{ref.replace(' ', '_')}", params={"with_text": 0})
            r.raise_for_status()
            links = r.json()
        seen: dict[str, dict[str, Any]] = {}
        for x in links if isinstance(links, list) else []:
            kind = x.get("category")
            if kind not in KINDS:
                continue
            title = x.get("collectiveTitle", {}).get("en") if isinstance(x.get("collectiveTitle"), dict) else None
            title = title or x.get("index_title") or ""
            if title in seen:  # one entry per work (Rashi's several comments on a verse: the first)
                continue
            date = x.get("compDate") or []
            seen[title] = {
                "kind": kind,
                "title": title,
                "ref": x.get("ref"),
                "year": date[0] if date and isinstance(date[0], int) else None,
                "has_en": bool(x.get("sourceHasEn")),
                "url": "https://www.sefaria.org/" + str(x.get("ref", "")).replace(" ", "_"),
            }
        rows = sorted(
            seen.values(), key=lambda e: (KINDS.index(e["kind"]), e["year"] if e["year"] is not None else 9999)
        )
        rows = rows[:24]
        # the English of the first dozen, where its licence lets it be shown
        with ThreadPoolExecutor(4) as pool:
            texts = list(pool.map(_sefaria_text, [e["ref"] if e["has_en"] else None for e in rows[:12]]))
        for e, t in zip(rows, texts, strict=False):
            if t:
                e.update(t)
        return {"ref": ref, "url": "https://www.sefaria.org/" + ref.replace(" ", "_"), "sources": rows}

    return _cached(f"sef:{ref}", fetch)


def _sefaria_text(ref: str | None) -> dict[str, Any] | None:
    if not ref:
        return None
    try:
        with _client() as http:
            r = http.get(f"https://www.sefaria.org/api/v3/texts/{ref.replace(' ', '_')}", params={"version": "english"})
            r.raise_for_status()
            versions = r.json().get("versions") or []
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return None  # this one text is left unquoted; the rest still show
    for v in versions:
        text = v.get("text")
        if isinstance(text, list):
            text = " ".join(t for t in text if isinstance(t, str))
        if v.get("language") == "en" and isinstance(text, str) and text.strip():
            if not _open_licence(v.get("license")):
                return {"licence": v.get("license"), "translation": v.get("versionTitle")}  # linked, not quoted
            return {"text": _plain(text)[:900], "licence": v.get("license"), "translation": v.get("versionTitle")}
    return None


# ----------------------------------------------------------------------------- Wikimedia Commons: art


def art(query: str, limit: int = 8) -> list[dict[str, Any]] | None:
    """Paintings, icons and manuscript images on Wikimedia Commons, with their licence and credit."""
    q = " ".join(query.split())[:150]
    if not q:
        return []

    def fetch() -> list[dict[str, Any]]:
        with _client() as http:
            r = http.get(
                "https://commons.wikimedia.org/w/api.php",
                params={
                    "action": "query",
                    "format": "json",
                    "formatversion": 2,
                    "generator": "search",
                    "gsrsearch": f"{q} filetype:bitmap",
                    "gsrnamespace": 6,
                    "gsrlimit": 40,
                    "prop": "imageinfo",
                    "iiprop": "url|extmetadata|size",
                    "iiurlwidth": 640,
                },
            )
            r.raise_for_status()
            pages = sorted(r.json().get("query", {}).get("pages", []), key=lambda p: p.get("index", 0))
        out: list[dict[str, Any]] = []
        artists: set[str] = set()
        wanted = _words(q)
        for p in pages:
            info = (p.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            licence = (meta.get("LicenseShortName") or {}).get("value")
            if not _open_licence(licence) or not info.get("thumburl"):
                continue
            # one work per artist, known by surname ("Paolo Veronese" and "Veronese" are one painter)
            words = re.findall(r"[a-zà-ÿ]{3,}", _plain((meta.get("Artist") or {}).get("value")).lower())
            who = words[-1] if words and words[-1] not in ("photographer", "unknown", "anonymous") else ""
            if who and who in artists:
                continue
            title = re.sub(r"^File:|\.\w+$", "", p.get("title", "")).replace("_", " ")
            cats = _plain((meta.get("Categories") or {}).get("value"))
            if not ART.search(cats) or NOT_ART.search(cats) or not (wanted & _words(f"{title} {cats}")):
                continue  # not a work of art, or not of this scene (a stray match on one word of the search)
            if any(_same_work(title, info, o) for o in out):
                continue  # another photograph of a painting already shown
            artists.add(who)
            out.append(
                {
                    "title": title,
                    "thumb": info["thumburl"],
                    "width": info.get("thumbwidth"),
                    "height": info.get("thumbheight"),
                    "page": info.get("descriptionurl"),
                    "artist": _plain((meta.get("Artist") or {}).get("value"))[:120] or None,
                    "date": _plain((meta.get("DateTimeOriginal") or {}).get("value"))[:40] or None,
                    "licence": licence,
                    "description": _plain((meta.get("ImageDescription") or {}).get("value"))[:300] or None,
                }
            )
            if len(out) >= limit:
                break
        return out

    return _cached(f"art:{q.lower()}", fetch)


_COMMON = {"the", "and", "of", "in", "at", "de", "la", "le", "les", "des", "zu", "die", "der", "with", "painting"}
#: Commons categories that mark a work of art (or a photograph of one)
ART = re.compile(
    r"artworks? |paintings|in art\b|icons?\b|mosaics?|fresco|stained glass|illuminat|engravings?|"
    r"bible illustrations|azulejo|tissot|dor[ée] bible|altarpiece|manuscripts?\b|codex",
    re.I,
)


#: scans of old books' pages (their engravings match a search on any word of a book's title)
NOT_ART = re.compile(r"internet archive book images|flickr's 'the commons'|\b1[6-9]\d\d books\b|fleurons", re.I)


def _words(text: str) -> set[str]:
    """The telling words of a text: four letters or more, not the common ones."""
    return {w for w in re.findall(r"[a-zà-ÿ]{4,}", text.lower()) if w not in _COMMON | {"jesus", "christ", "with"}}


def _same_work(title: str, info: dict[str, Any], other: dict[str, Any]) -> bool:
    """Two photographs of one painting: nearly the same shape, and a word of the title in common."""
    w, h, ow, oh = info.get("thumbwidth"), info.get("thumbheight"), other.get("width"), other.get("height")
    if not (w and h and ow and oh):
        return False
    if abs((w / h) / (ow / oh) - 1) > 0.025:
        return False
    words = {x for x in re.findall(r"\w{4,}", title.lower()) if x not in _COMMON}
    return bool(words & {x for x in re.findall(r"\w{4,}", other["title"].lower()) if x not in _COMMON})


# ----------------------------------------------------------------------------- the API the pages use


@router.get("/scholarship")
def scholarship_api(request: Request, q: str = Query(..., min_length=2, max_length=200)) -> dict[str, Any]:
    _maybe_limit(request, f"oa:{' '.join(q.split()).lower()}")
    return {"works": _found(scholarship(q))}


@router.get("/jewish/{osis}")
def jewish_api(request: Request, osis: str) -> dict[str, Any]:
    if not re.fullmatch(r"[1-3]?[A-Za-z]+\.\d{1,3}\.\d{1,3}", osis):
        raise HTTPException(400, "give one verse, e.g. Isa.53.5")
    s = store(request)
    ref = sefaria_ref(s, osis)
    if ref:
        _maybe_limit(request, f"sef:{ref}")
    if ref is None:
        return {"ref": None, "sources": []}
    return _found(jewish(s, osis))


@router.get("/art")
def art_api(request: Request, q: str = Query(..., min_length=2, max_length=150)) -> dict[str, Any]:
    _maybe_limit(request, f"art:{' '.join(q.split()).lower()}")
    return {"images": _found(art(q))}


def _found(value: Any) -> Any:
    """An answer, or 503 when the source could not be reached (never kept by the CDN, unlike an empty answer)."""
    if value is None:
        raise HTTPException(503, "that source could not be reached just now")
    return value


def _maybe_limit(request: Request, key: str) -> None:
    """Count a visitor's lookups only when the answer is not already kept."""
    with _cache_lock:
        hit = _cache.get(key)
    if not (hit and hit[0] > time.time()):
        _rate_limit(request)
