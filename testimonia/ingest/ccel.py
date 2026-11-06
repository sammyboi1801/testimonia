"""Church fathers from CCEL ThML: Schaff's Ante-Nicene Fathers (1–9), Nicene & Post-Nicene Fathers
(series 1 & 2) and Aquinas' Catena Aurea — full texts, sections, and every tagged Scripture citation.

Local use only for now (source.public = false): the translations are public domain, but CCEL asks
to be contacted before its files are republished.

How works are found: each volume's top-level divisions are classified as front matter (skipped),
a *group* (an author or a collection whose sub-divisions are the works), or a *work* in itself.
Consecutive books of one work ("Against Heresies: Book I … Book V") are merged. Authors come from
author headings or, where headings do not name them, from VOLUME_AUTHORS / DIVISION_AUTHORS.
Corrections without code changes: curated/ccel_overrides.csv (div id → skip / title / author / category).
"""

from __future__ import annotations

import csv
import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, ClassVar

from lxml import etree

from ..books import resolve_book
from ..config import CURATED_DIR
from ..refs import Range, parse_osis
from .base import Context, IngestError, batched, step

SOURCES = ("ccel-schaff", "catena-aurea")
VOLUMES = (
    [f"anf0{i}" for i in range(1, 10)]
    + [f"npnf1{i:02d}" for i in range(1, 15)]
    + [f"npnf2{i:02d}" for i in range(1, 15)]
    + ["catena1", "catena2"]
)

_SKIP = re.compile(
    r"^(title page|second title page|series title|preface|editor[’']?s preface|translator[’']?s preface|"
    r"credits|contents|table of contents|introductory (note|notice|essay)|elucidations?|"
    r"index|indexes|subject index|general index|"
    r"prolegomena|chief events|dedication|genealogical tables|chronological table|comparative table|"
    r"bibliographical introduction|general introduction|excursus|appended note|works on analytical|dates of "
    r"treatises|literature|notes?|st\. chrysostom as a homilist|the nicene creed|prefatory notice|general note|"
    r"translator[’']?s introductory|editorial preface)",
    re.I,
)
_SKIP_ANYWHERE = re.compile(r"\bindex(es)?\b|\bpreface\b|\bprolegomena\b", re.I)


def is_front_matter(title: str) -> bool:
    return bool(_SKIP.match(title) or _SKIP_ANYWHERE.search(title))


_GROUP = re.compile(
    r"(apocrypha|remains|memoirs|decretals|literature|treatises|writings|works|controversy|dogmatic|ethical|"
    r"ascetic|philosophical|apologetic|oratorical|anti-marcion|appendix|minor writers|part \w+|letters and sermons|"
    r"pastoral rule|homilies of ephraim|hymns and homilies|two epistles concerning|^title page$)",
    re.I,
)
_BOOK_SUFFIX = re.compile(r"[:,.—\-\s]+(book|part)\s+([IVXLC]+|\d+|first|second|third|fourth|fifth)\b.*$", re.I)

VOLUME_AUTHORS = {
    "anf03": "Tertullian",
    **{f"npnf1{i:02d}": "Augustine of Hippo" for i in range(1, 9)},
    **{f"npnf1{i:02d}": "John Chrysostom" for i in range(9, 15)},
    "npnf201": "Eusebius of Caesarea",
    "npnf204": "Athanasius of Alexandria",
    "npnf205": "Gregory of Nyssa",
    "npnf206": "Jerome",
    "npnf208": "Basil of Caesarea",
    "npnf210": "Ambrose of Milan",
    "catena1": "Thomas Aquinas",
    "catena2": "Thomas Aquinas",
}
DIVISION_AUTHORS = {
    ("npnf202", "ii"): "Socrates Scholasticus",
    ("npnf202", "iii"): "Sozomen",
    ("npnf203", "iv"): "Theodoret",
    ("npnf203", "v"): "Jerome",
    ("npnf203", "vi"): "Rufinus of Aquileia",
    ("npnf207", "ii"): "Cyril of Jerusalem",
    ("npnf207", "iii"): "Gregory of Nazianzus",
    ("npnf207", "iv"): "Gregory of Nazianzus",
    ("npnf209", "ii"): "Hilary of Poitiers",
    ("npnf209", "iii"): "John of Damascus",
    ("npnf211", "ii"): "Sulpicius Severus",
    ("npnf211", "iii"): "Vincent of Lérins",
    ("npnf211", "iv"): "John Cassian",
    ("npnf212", "ii"): "Leo the Great",
    ("npnf212", "iii"): "Gregory the Great",
    ("npnf213", "ii"): "Gregory the Great",
    ("npnf213", "iii"): "Ephrem the Syrian",
}
APOSTOLIC = {
    "clement of rome",
    "mathetes",
    "polycarp",
    "ignatius",
    "barnabas",
    "papias",
    "the pastor of hermas",
    "the teaching of the twelve apostles",
    "the second epistle of clement",
}
OT_PSEUDEPIGRAPHA = re.compile(r"testaments? of (the twelve patriarchs|abraham)|apocalypse of sedrach", re.I)
NT_APOCRYPHA = re.compile(
    r"apocrypha of the new testament|gospel of peter|apocalypse of (peter|the virgin)|"
    r"vision of paul|acts of xanthippe|narrative of zosimus|pseudo-clementine",
    re.I,
)


def slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text.replace("Æ", "Ae").replace("æ", "ae"))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def clean_title(t: str | None) -> str:
    return re.sub(r"\s+", " ", (t or "")).strip().rstrip(".").strip()


def author_name(heading: str) -> str:
    """'IRENÆUS' → 'Irenæus', 'Tertullian: Part Fourth.' → 'Tertullian'."""
    h = re.split(r"[:]", clean_title(heading))[0].strip()
    return smart_title(h) if h.isupper() else h


def smart_title(text: str) -> str:
    """'CLEMENT OF ROME' → 'Clement of Rome'; 'THE PASTOR OF HERMAS' → 'The Pastor of Hermas'."""
    small = {"of", "the", "and", "to", "in", "on", "a", "an"}
    words = text.lower().split()
    return " ".join(w if i and w in small else w[:1].upper() + w[1:] for i, w in enumerate(words))


_NOT_A_NAME = {
    "acts",
    "apocalypse",
    "apology",
    "book",
    "books",
    "constitutions",
    "early",
    "epistle",
    "epistles",
    "excerpts",
    "fragments",
    "gospel",
    "history",
    "homilies",
    "homily",
    "letter",
    "letters",
    "life",
    "memoirs",
    "narrative",
    "on",
    "passion",
    "remains",
    "revelation",
    "sermons",
    "teaching",
    "testament",
    "testaments",
    "the",
    "treatise",
    "treatises",
    "two",
    "three",
    "vision",
    "works",
    "writings",
    "city",
    "lectures",
}


def is_author_heading(title: str, volume: str = "anf") -> bool:
    """Author headings ('IRENÆUS', 'Peter of Alexandria') occur only in the Ante-Nicene volumes."""
    t = clean_title(title)
    if not volume.startswith("anf") or not t or len(t.split()) > 5:
        return False
    if t.split()[0].lower().strip(":,") in _NOT_A_NAME:
        return False
    return t.isupper() or bool(re.match(r"^[A-Z][a-z]+(\s(of|the)\s[A-Z][a-z]+|\s[A-Z][a-z]+)*(:.*)?$", t))


@dataclass
class WorkSpec:
    id: str
    title: str
    volume: str
    divs: list[Any] = field(default_factory=list)  # lxml elements making up the work (books in order)
    author: str | None = None
    category: str = "church-father"


def load_overrides() -> dict[tuple[str, str], dict[str, str]]:
    path = CURATED_DIR / "ccel_overrides.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as fh:
        return {(r["volume"], r["div_id"]): r for r in csv.DictReader(fh)}


def classify(volume: str, root: Any, overrides: dict[tuple[str, str], dict[str, str]]) -> list[WorkSpec]:
    """Find the works in one ThML volume (deterministic; see module docstring)."""
    works: list[WorkSpec] = []
    for d1 in root.iter("div1"):
        title1 = clean_title(d1.get("title"))
        ov = overrides.get((volume, d1.get("id", "")), {})
        if ov.get("action") == "skip" or (not ov and is_front_matter(title1)):
            continue
        children = [d for d in d1 if isinstance(d.tag, str) and d.tag == "div2"]
        group = ov.get("action") == "group" or (
            ov.get("action") != "work"
            and children
            and (is_author_heading(title1, volume) or bool(_GROUP.search(title1)))
            and not title1.upper().startswith("THE PASTOR")
        )
        div_author = DIVISION_AUTHORS.get((volume, d1.get("id", "")))
        default_author = div_author or VOLUME_AUTHORS.get(volume)
        if group:
            head = title1.split(":")[0]
            heading_author = author_name(head) if is_author_heading(head, volume) and not _GROUP.search(head) else None
            minor_writers = bool(re.search(r"minor writers|remains", title1, re.I))
            author = ov.get("author") or heading_author or default_author
            for d2 in children:
                t2 = clean_title(d2.get("title"))
                if is_front_matter(t2) or not _has_text(d2):
                    continue
                base = _BOOK_SUFFIX.sub("", t2) or t2
                work_author = author
                if minor_writers and not heading_author and is_author_heading(t2, volume):
                    work_author, base = author_name(t2), f"Writings of {author_name(t2)}"
                if works and works[-1].volume == volume and works[-1].title == base and works[-1].author == work_author:
                    works[-1].divs.append(d2)  # next book of the same work
                    continue
                works.append(WorkSpec("", base, volume, [d2], work_author, _category(volume, title1, t2, work_author)))
        elif _has_text(d1):
            author = ov.get("author") or default_author
            title = ov.get("title") or (smart_title(title1) if title1.isupper() else title1)
            if volume.startswith("catena"):
                title = f"Catena Aurea: {title}"
            category = ov.get("category") or _category(volume, title1, title1, author)
            works.append(WorkSpec("", title, volume, [d1], author, category))
    seen: dict[str, int] = {}
    for w in works:
        base_id = f"{slug(w.author) + '.' if w.author else ''}{slug(w.title)[:60]}"
        n = seen.get(base_id, 0)
        seen[base_id] = n + 1
        w.id = base_id if n == 0 else f"{base_id}-{n + 1}"
    return works


def _category(volume: str, group_title: str, title: str, author: str | None) -> str:
    text = f"{group_title} {title}"
    if volume.startswith("catena"):
        return "catena"
    if volume == "npnf214":
        return "council"
    if NT_APOCRYPHA.search(text):
        return "nt-apocrypha"
    if OT_PSEUDEPIGRAPHA.search(text):
        return "ot-pseudepigrapha"
    if re.search(r"liturg|constitutions of the holy apostles", text, re.I):
        return "liturgical"
    if (author and author.lower() in APOSTOLIC) or group_title.lower() in APOSTOLIC:
        return "apostolic-father"
    return "church-father"


def _has_text(div: Any) -> bool:
    return any(len("".join(p.itertext()).strip()) > 40 for p in div.iter("p"))


# ------------------------------------------------------------------------------------------- sections

_KEEP = {
    "p": "p",
    "i": "i",
    "em": "i",
    "b": "b",
    "strong": "b",
    "sup": "sup",
    "sub": "sub",
    "br": "br",
    "h1": "h4",
    "h2": "h4",
    "h3": "h4",
    "h4": "h5",
    "h5": "h6",
    "h6": "h6",
    "blockquote": "blockquote",
    "ul": "ul",
    "ol": "ol",
    "li": "li",
    "table": "table",
    "tr": "tr",
    "td": "td",
    "span": "span",
}


@dataclass
class Section:
    cite: str
    title: str
    html: str
    text: str
    refs: list[tuple[str, bool, str]]  # (osisRef, in_note, snippet)


def leaf_sections(work_divs: list[Any]) -> Iterator[Section]:
    """Leaf divisions of a work with dotted ordinal citations relative to the work ('3.11')."""

    def walk(div: Any, path: tuple[int, ...]) -> Iterator[Section]:
        kids = [d for d in div if isinstance(d.tag, str) and re.match(r"^div\d$", d.tag)]
        if not kids:
            if _has_text(div):
                yield _section(div, ".".join(map(str, path)) or "1")
            return
        own = [c for c in div if isinstance(c.tag, str) and c.tag == "p"]
        if own and any(len("".join(p.itertext()).strip()) > 40 for p in own):
            yield _section(div, ".".join(map(str, path)) + ".0" if path else "0", only_own=True)
        for i, k in enumerate(kids, start=1):
            yield from walk(k, (*path, i))

    if len(work_divs) == 1:
        yield from walk(work_divs[0], ())
    else:
        for b, div in enumerate(work_divs, start=1):
            yield from walk(div, (b,))


def _section(div: Any, cite: str, only_own: bool = False) -> Section:
    title = clean_title(div.get("title"))
    src = etree.Element("div")
    for child in div:
        if only_own and isinstance(child.tag, str) and re.match(r"^div\d$", child.tag):
            continue
        src.append(_copy(child))
    refs: list[tuple[str, bool, str]] = []
    for sr in src.iter("scripRef"):
        osis = sr.get("osisRef") or ""
        in_note = any(a.tag == "note" for a in sr.iterancestors())
        refs.append((osis, in_note, _snippet(sr)))
    text = " ".join(" ".join(t for t in _plain_parts(src)).split())
    return Section(cite, title, _to_html(src), text, refs)


def _copy(el: Any) -> Any:
    return etree.fromstring(etree.tostring(el))


def _plain_parts(el: Any) -> Iterator[str]:
    """Text of an element without footnotes (an element's own tail is left to its parent)."""
    if el.text and el.tag != "note":
        yield el.text
    for child in el:
        if isinstance(child.tag, str) and child.tag != "note":
            yield from _plain_parts(child)
        if child.tail:
            yield child.tail


def _snippet(scrip_ref: Any) -> str:
    """Context for a citation: the paragraph it belongs to (for a footnote, the paragraph carrying the note)."""
    note = next((a for a in scrip_ref.iterancestors() if a.tag == "note"), None)
    anchor = note if note is not None else scrip_ref
    para = next((a for a in anchor.iterancestors() if a.tag == "p"), None)
    if para is None:
        return ""
    return " ".join(" ".join(_plain_parts(para)).split())[:280]


def _to_html(src: Any) -> str:
    # Footnotes become inline <span class="note">; HTML forbids <p> inside a span (browsers would split the
    # note apart), so paragraphs inside notes become <span class="np"> first.
    for note in src.iter("note"):
        for p in note.iter("p"):
            p.tag = "note-p"
    for el in list(src.iter()):
        if not isinstance(el.tag, str) or el is src:
            continue
        if el.tag == "note-p":
            el.attrib.clear()
            el.tag = "span"
            el.set("class", "np")
            continue
        tag = el.tag
        if tag == "scripRef":
            osis = (el.get("osisRef") or "").replace("Bible:", "").split()
            for a in list(el.attrib):
                del el.attrib[a]
            el.tag = "a"
            el.set("class", "ref")
            if osis:
                el.set("data-ref", osis[0])
        elif tag == "note":
            n = el.get("n", "")
            for a in list(el.attrib):
                del el.attrib[a]
            el.tag = "span"
            el.set("class", "note")
            if n:
                el.set("data-n", n)
        elif tag in ("foreign", "span") and el.get("lang"):
            lang = el.get("lang")
            el.attrib.clear()
            el.tag = "span"
            el.set("lang", lang or "")
        elif tag in _KEEP:
            keep_class = el.get("class") if tag == "p" else None
            el.attrib.clear()
            el.tag = _KEEP[tag]
            if keep_class in ("endnote", "Blockquote"):
                el.set("class", keep_class.lower())
        elif tag in ("pb", "index", "added", "insertIndex", "deleted"):
            el.tag = "_drop_"
        else:
            el.attrib.clear()
            el.tag = "_unwrap_"
    etree.strip_elements(src, "_drop_", with_tail=False)
    etree.strip_tags(src, "_unwrap_")
    html = "".join(etree.tostring(c, encoding="unicode", method="html") for c in src)
    return html.strip()


# ------------------------------------------------------------------------------------------- step


class People:
    """Resolve CCEL author headings to existing people (e.g. 'Hippolytus' → 'hippolytus-of-rome')."""

    def __init__(self, ctx: Context) -> None:
        self.years: dict[str, int | None] = {r[0]: r[1] for r in ctx.con.execute("SELECT id, floruit_to FROM person")}

    def resolve(self, name: str) -> str:
        sid = slug(name)
        if sid in self.years:
            return sid
        prefixed = [p for p in self.years if p.startswith(sid + "-")]
        return prefixed[0] if len(prefixed) == 1 else sid

    def year(self, pid: str | None) -> int | None:
        return self.years.get(pid) if pid else None


class RefResolver:
    """Turn CCEL osisRef values into hub verse keys.

    CCEL marks references in Septuagint or Vulgate numbering ('Bible.lxx:Ps.22.1', 'Bible.vul:Ps.22.1').
    Those are converted with the native→hub mappings already computed for the Brenton (LXX) and
    Clementine Vulgate editions by the TVTMS engine, so the same rules apply everywhere.
    """

    EDITION_FOR: ClassVar[dict[str, str]] = {"lxx": "brenton", "vul": "vulgate"}

    def __init__(self, ctx: Context) -> None:
        self.known = {r[0] for r in ctx.con.execute("SELECT vkey FROM verse")}
        self.maps: dict[str, dict[str, int]] = {}
        for tradition, edition in self.EDITION_FOR.items():
            mapping: dict[str, int] = {}
            for native, k in ctx.con.execute(
                "SELECT native_ref, vkey FROM edition_verse WHERE edition_id = ? AND native_ref IS NOT NULL", (edition,)
            ):
                for one in native.split(","):
                    mapping.setdefault(one.split("-")[0].rstrip("abcdefghijklmnopqrstuvwxyz"), k)
            self.maps[tradition] = mapping

    def resolve(self, raw: str) -> tuple[int, int] | None:
        """'Bible:John.1.18' / 'Bible.lxx:Ps.22.1-Ps.22.3' / 'Jon.1.1' → (start_vkey, end_vkey), or None."""
        tradition = ""
        m = re.match(r"^Bible(?:\.(\w+))?:(.*)$", raw)
        if m:
            tradition, raw = (m.group(1) or "").lower(), m.group(2)
        r = parse_osis(raw) or self._alias(raw)
        if r is None:
            return None
        start, end = r.start, r.end
        if tradition in self.maps:
            mapping = self.maps[tradition]
            start = mapping.get(f"{r.book}.{r.c1}.{r.v1 or 1}", start)
            end = mapping.get(f"{r.book}.{r.c2}.{r.v2}", end) if r.v2 not in (0, 999) else end
            if end < start:
                end = start
        if r.v1 != 0 and start not in self.known:
            return None
        return start, end

    @staticmethod
    def _alias(raw: str) -> Range | None:
        """Non-OSIS book codes CCEL occasionally uses ('Jon' for Jonah)."""
        m = re.match(r"^([1-4]?[A-Za-z]+)(\..*)$", raw)
        if not m:
            return None
        book = resolve_book(m.group(1))
        return parse_osis(book + m.group(2)) if book else None


def era_for(year: int | None) -> str | None:
    if year is None:
        return None
    if year <= 150:
        return "apostolic"
    if year <= 325:
        return "ante-nicene"
    if year <= 451:
        return "nicene"
    if year <= 750:
        return "late-patristic"
    if year <= 1500:
        return "medieval"
    return "reformation" if year <= 1700 else "modern"


@step("ccel", sources=SOURCES, requires=["verses", "hcf-commentaries"])
def ingest_ccel(ctx: Context) -> None:
    """Church fathers (ANF, NPNF1, NPNF2, Catena Aurea): works, sections and Scripture citations."""
    overrides = load_overrides()
    people = People(ctx)
    resolver = RefResolver(ctx)
    folder = ctx.paths("ccel-schaff")[0].parent  # raw/ccel/
    stats = {"works": 0, "sections": 0, "citations": 0, "unparsed_refs": 0}
    for volume in VOLUMES:
        source = "catena-aurea" if volume.startswith("catena") else "ccel-schaff"
        path = folder / f"{volume}.xml"
        if not path.exists():
            raise IngestError(f"CCEL volume missing: {path} — run `testimonia fetch {source}`")
        root = etree.parse(str(path), etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False)).getroot()
        translator = None  # DC.Contributor is the digitiser, not the translator; ANF/NPNF translators vary per work
        for spec in classify(volume, root, overrides):
            _ingest_work(ctx, spec, source, translator, people, resolver, stats)
    ctx.log.info(
        "  %d works, %d sections, %d Scripture citations (%d unparseable refs skipped)",
        stats["works"],
        stats["sections"],
        stats["citations"],
        stats["unparsed_refs"],
    )


def _ingest_work(
    ctx: Context,
    spec: WorkSpec,
    source: str,
    translator: str | None,
    people: People,
    resolver: RefResolver,
    stats: dict[str, int],
) -> None:
    author_id = people.resolve(spec.author) if spec.author else None
    year = people.year(author_id)
    if author_id and author_id not in people.years:
        people.years[author_id] = None
        ctx.con.execute(
            "INSERT OR IGNORE INTO person (id, name, kind, era, floruit_to, source_id) VALUES (?,?,?,?,?,?)",
            (author_id, spec.author, "father", era_for(year), year, source),
        )
    ctx.con.execute(
        "INSERT OR IGNORE INTO work (id, author_id, title, category, era, source_id) VALUES (?,?,?,?,?,?)",
        (spec.id, author_id, spec.title, spec.category, era_for(year), source),
    )
    edition_id = f"{spec.id}@{spec.volume}"
    ctx.con.execute(
        "INSERT OR IGNORE INTO work_edition (id, work_id, language, kind, translator, year, is_default, source_id) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (edition_id, spec.id, "eng", "translation", translator, 1890, 1, source),
    )
    sections, citations = [], []
    for ord_, sec in enumerate(leaf_sections(spec.divs), start=1):
        sections.append((edition_id, ord_, sec.cite, None, sec.cite.count(".") + 1, sec.title, sec.html, sec.text))
        for osis, in_note, snippet in sec.refs:
            for one in osis.split():
                span = resolver.resolve(one)
                if span is None:
                    stats["unparsed_refs"] += 1
                    continue
                citations.append(
                    (
                        span[0],
                        span[1],
                        spec.id,
                        edition_id,
                        ord_,
                        sec.cite,
                        author_id,
                        year,
                        "reference" if in_note else "quotation",
                        snippet or None,
                        source,
                    )
                )
    for batch in batched(sections):
        ctx.insert("work_section", ["edition_id", "ord", "cite", "parent_ord", "level", "title", "html", "text"], batch)
    for batch in batched(citations):
        ctx.insert(
            "citation",
            [
                "start_vkey",
                "end_vkey",
                "work_id",
                "edition_id",
                "section_ord",
                "cite",
                "author_id",
                "year",
                "kind",
                "snippet",
                "source_id",
            ],
            batch,
        )
    stats["works"] += 1
    stats["sections"] += len(sections)
    stats["citations"] += len(citations)
