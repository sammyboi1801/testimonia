"""Jewish and Roman witnesses: Josephus, Tacitus, Suetonius, Pliny the Younger and Lucian.

* Josephus (Whiston 1737) from CCEL ThML — the same markup as the church fathers, so the CCEL helpers turn it into
  sections, footnotes and Scripture links (Whiston's notes cite Scripture; those links are kept as 'comment').
* Tacitus, Annals (Church & Brodribb) from the Perseus TEI, one section per book with chapter numbers inline.
* Suetonius, Pliny and Lucian from public-domain plain texts: only the passages about Christ and the Christians.
* curated/witness_links.csv ties well-known passages to the Bible (Antiquities 19.8.2 ↔ Acts 12:20–23 …).
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from lxml import etree

from ..refs import parse_refs
from .base import Context, IngestError, step
from .ccel import RefResolver, Section, _section, smart_title
from .curated import read_csv

JOSEPHUS = "ccel-josephus"
TACITUS = "perseus-tacitus"
ROMAN = "pd-roman-witnesses"
CURATED = "testimonia-curated"
TEI = "{http://www.tei-c.org/ns/1.0}"


@dataclass
class Work:
    id: str
    title: str
    author: str
    category: str
    date_from: int
    date_to: int
    edition: str
    translator: str
    year: int
    source: str
    sections: list[Section]
    language: str = "eng"


# ----------------------------------------------------------------------------- Josephus (ThML)

JOSEPHUS_WORKS = {  # div1 id → (work id, title, written)
    "i": ("josephus.life", "The Life of Flavius Josephus", (99, 100)),
    "ii": ("josephus.antiquities", "Antiquities of the Jews", (93, 94)),
    "iii": ("josephus.war", "The Wars of the Jews", (75, 79)),
    "iv": ("josephus.apion", "Against Apion", (95, 100)),
}
SECTION_NO = re.compile(r"^\s*(\d+)\.\s")


def _divs(el: Any, level: int) -> list[Any]:
    return [d for d in el if isinstance(d.tag, str) and d.tag == f"div{level}"]


def _numbered(el: Any) -> list[Any]:
    """Paragraphs that start a numbered Whiston section ('3. Now there was about this time Jesus…')."""
    return [p for p in el if isinstance(p.tag, str) and p.tag == "p" and SECTION_NO.match("".join(p.itertext()))]


def _chunks(div: Any, cite: str, size: int = 6) -> Iterator[Section]:
    """A long run of numbered paragraphs (Life, Against Apion) as pages of `size` sections each."""
    paras = _numbered(div)
    for i in range(0, len(paras), size):
        group = paras[i : i + size]
        first = SECTION_NO.match("".join(group[0].itertext()))
        last = SECTION_NO.match("".join(group[-1].itertext()))
        a, b = (first.group(1) if first else "?"), (last.group(1) if last else "?")
        page = etree.Element("div", title=f"§{a}–{b}" if a != b else f"§{a}")
        for p in group:
            page.append(etree.fromstring(etree.tostring(p)))
        yield _section(page, f"{cite}.{a}" if cite else a)


def _chapter_title(div: Any) -> str:
    h = next((c for c in div if isinstance(c.tag, str) and c.tag in ("h2", "h3", "h4")), None)
    text = " ".join("".join(h.itertext()).split()) if h is not None else (div.get("title") or "")
    text = re.sub(r"^CHAPTER\s+\d+\.\s*", "", text).rstrip(",;. ")
    return smart_title(text.lower().capitalize()) if text.isupper() else text


def josephus(path: Path) -> list[Work]:
    root = etree.parse(str(path), etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False)).getroot()
    body = {d.get("id"): d for d in root.iter("div1")}
    works = []
    for div_id, (wid, title, (start, end)) in JOSEPHUS_WORKS.items():
        div1 = body.get(div_id)
        if div1 is None:
            raise IngestError(f"Josephus: division {div_id!r} ({title}) not found in {path.name}")
        sections: list[Section] = []
        books = _divs(div1, 2)
        if not books:  # the Life: numbered paragraphs only
            sections.extend(_chunks(div1, ""))
        book_no = 0
        for book in books:
            if re.search(r"preface", book.get("title") or "", re.I):
                sec = _section(book, "pref")
                sec.title = "Preface"
                sections.append(sec)
                continue
            book_no += 1
            chapters = _divs(book, 3)
            if not chapters:  # Against Apion: books without chapters
                for sec in _chunks(book, str(book_no)):
                    sec.title = f"Book {book_no}, {sec.title}"
                    sections.append(sec)
                continue
            for ch_no, chapter in enumerate(chapters, start=1):
                sec = _section(chapter, f"{book_no}.{ch_no}")
                sec.title = f"Book {book_no}, chapter {ch_no}. {_chapter_title(chapter)}"
                sections.append(sec)
        works.append(
            Work(
                wid,
                title,
                "josephus",
                "jewish",
                start,
                end,
                f"{wid}@whiston",
                "William Whiston",
                1737,
                JOSEPHUS,
                sections,
            )
        )
    return works


# ----------------------------------------------------------------------------- Tacitus (Perseus TEI)


def _tei_html(p: Any) -> str:
    """A TEI paragraph as HTML: names and places become plain text, notes become footnote spans."""
    out = [html.escape(p.text or "")]
    for child in p:
        tag = etree.QName(child).localname if isinstance(child.tag, str) else ""
        inner = html.escape("".join(str(t) for t in child.itertext()))
        out.append(f'<span class="note">{inner}</span>' if tag == "note" else inner)
        out.append(html.escape(child.tail or ""))
    return "".join(out).strip()


def tacitus(path: Path) -> list[Work]:
    root = etree.parse(str(path), etree.XMLParser(recover=True, huge_tree=True)).getroot()
    sections = []
    for book in root.iter(f"{TEI}div"):
        if book.get("subtype") != "book":
            continue
        n = book.get("n") or "?"
        parts, plain = [], []
        for chapter in book.iter(f"{TEI}div"):
            if chapter.get("subtype") != "chapter":
                continue
            c = chapter.get("n") or "?"
            paras = [_tei_html(p) for p in chapter.iter(f"{TEI}p")]
            if not paras:
                continue
            parts.append(f'<p id="c{c}"><b class="cn">{c}</b> ' + "</p><p>".join(paras) + "</p>")
            text = " ".join("".join(str(t) for t in p.itertext()) for p in chapter.iter(f"{TEI}p"))
            plain.append(f"{c} " + " ".join(text.split()))
        sections.append(Section(n, f"Book {n}", "".join(parts), " ".join(plain), []))
    if not any(s.cite == "15" for s in sections):
        raise IngestError(f"Tacitus: book 15 missing from {path.name}")
    return [
        Work(
            "tacitus.annals",
            "Annals",
            "tacitus",
            "pagan",
            115,
            120,
            "tacitus.annals@church-brodribb",
            "A. J. Church & W. J. Brodribb",
            1876,
            TACITUS,
            sections,
        )
    ]


# ----------------------------------------------------------------------------- plain-text witnesses


def gutenberg_body(path: Path) -> list[str]:
    """Lines between the START and END markers (header, footer and licence removed)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith("*** START OF")), None)
    end = next((i for i, ln in enumerate(lines) if ln.startswith("*** END OF")), None)
    if start is None or end is None:
        raise IngestError(f"{path.name}: Project Gutenberg START/END markers not found")
    return lines[start + 1 : end]


def _between(lines: list[str], start: re.Pattern[str], stop: re.Pattern[str], after: int = 0) -> tuple[list[str], int]:
    i = next((k for k in range(after, len(lines)) if start.match(lines[k])), None)
    if i is None:
        raise IngestError(f"heading {start.pattern!r} not found")
    j = next((k for k in range(i + 1, len(lines)) if stop.match(lines[k])), len(lines))
    return lines[i:j], i


def _paragraphs(lines: list[str]) -> list[str]:
    paras, cur = [], []
    for ln in lines:
        if ln.strip():
            cur.append(ln.strip())
        elif cur:
            paras.append(" ".join(cur))
            cur = []
    if cur:
        paras.append(" ".join(cur))
    return paras


def _clean(text: str) -> str:
    text = re.sub(r"\s*\[\d+\]", "", text)  # footnote markers
    text = re.sub(r"\s*\(\d{2,4}\)\s*", " ", text)  # printed page numbers in the Bohn Suetonius
    text = re.sub(r"#([^#]+)#", r"\1", text)  # transliterated Greek in the Fowler Lucian
    return " ".join(text.split())


def _plain(text: str) -> str:
    return re.sub(r"_([^_]+)_", r"", _clean(text))


def _para_html(text: str) -> str:
    esc = html.escape(_clean(text))
    return "<p>" + re.sub(r"_([^_]+)_", r"<i>\1</i>", esc) + "</p>"


def suetonius(path: Path) -> Work:
    lines = gutenberg_body(path)
    heading = re.compile(r"^[A-Z][A-Z .]{8,}\.(\s*\[\d+\])?\s*$")
    sections = []
    for name, pattern in (("Claudius", r"^TIBERIUS CLAUDIUS DRUSUS CAESAR\."), ("Nero", r"^NERO CLAUDIUS CAESAR\.")):
        block, _ = _between(lines, re.compile(pattern), heading)
        chapters: list[tuple[str, list[str]]] = []
        for para in _paragraphs(block[1:]):
            m = re.match(r"^([IVXLC]+)\.\s+(.*)$", para)
            if m:
                chapters.append((m.group(1), [m.group(2)]))
            elif chapters:
                chapters[-1][1].append(para)
        if len(chapters) < 40:
            raise IngestError(f"Suetonius {name}: only {len(chapters)} chapters parsed")
        body = "".join(
            f'<p id="c{_roman(r)}"><b class="cn">{_roman(r)}</b> {html.escape(_clean(ps[0]))}</p>'
            + "".join(_para_html(p) for p in ps[1:])
            for r, ps in chapters
        )
        text = " ".join(_plain(" ".join(ps)) for _, ps in chapters)
        sections.append(Section(name, f"Life of {name}", body, text, []))
    return Work(
        "suetonius.lives",
        "Lives of the Caesars (Claudius and Nero)",
        "suetonius",
        "pagan",
        119,
        122,
        "suetonius.lives@thomson-forester",
        "A. Thomson, rev. T. Forester",
        1855,
        ROMAN,
        sections,
    )


def _roman(r: str) -> int:
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
    total = 0
    for a, b in zip(r, r[1:] + " ", strict=True):
        total += -values[a] if b != " " and values[a] < values[b] else values[a]
    return total


def pliny(path: Path) -> Work:
    lines = gutenberg_body(path)
    # the heading also appears in the table of contents; the letters follow its last occurrence
    marks = [i for i, ln in enumerate(lines) if ln.startswith("CORRESPONDENCE WITH THE EMPEROR TRAJAN")]
    trajan = marks[-1] if marks else None
    if trajan is None:
        raise IngestError("Pliny: the correspondence with Trajan was not found")
    sections = []
    # Melmoth numbers the letters one higher than modern editions: his XCVII/XCVIII are 10.96/10.97.
    for melmoth, modern, title in (("XCVII", "10.96", "Pliny to Trajan"), ("XCVIII", "10.97", "Trajan to Pliny")):
        block, _ = _between(lines, re.compile(rf"^{melmoth}\b"), re.compile(r"^[IVXLC]+\b( --|\s+To\b)"), trajan)
        paras = _paragraphs(block[1:])
        sections.append(
            Section(modern, f"Letter {modern} — {title}", "".join(map(_para_html, paras)), _plain(" ".join(paras)), [])
        )
        if len(sections[-1].text) < 400:
            raise IngestError(f"Pliny {modern}: letter text not found")
    return Work(
        "pliny.letters",
        "Letters on the Christians (10.96–97)",
        "pliny-the-younger",
        "pagan",
        111,
        113,
        "pliny.letters@melmoth-bosanquet",
        "W. Melmoth, rev. F. C. T. Bosanquet",
        1878,
        ROMAN,
        sections,
    )


def lucian(path: Path) -> Work:
    lines = gutenberg_body(path)
    block, _ = _between(lines, re.compile(r"^THE DEATH OF PEREGRINE\s*$"), re.compile(r"^FOOTNOTES:"))
    paras = [p for p in _paragraphs(block[1:]) if not re.fullmatch(r"[A-Z]\.", p)]
    body = "".join(_para_html(p) for p in paras)
    return Work(
        "lucian.peregrinus",
        "The Death of Peregrine",
        "lucian-of-samosata",
        "pagan",
        165,
        170,
        "lucian.peregrinus@fowler",
        "H. W. & F. G. Fowler",
        1905,
        ROMAN,
        [Section("1", "The Death of Peregrine", body, _plain(" ".join(paras)), [])],
    )


# ----------------------------------------------------------------------------- step


def _store(ctx: Context, w: Work, resolver: RefResolver) -> int:
    ctx.register(w.source)
    ctx.con.execute(
        "INSERT INTO work (id, title, author_id, category, era, date_from, date_to, orig_language, source_id) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (w.id, w.title, w.author, w.category, _era(w.date_to), w.date_from, w.date_to, None, w.source),
    )
    ctx.con.execute(
        "INSERT INTO work_edition (id, work_id, language, kind, translator, year, is_default, source_id) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (w.edition, w.id, w.language, "translation", w.translator, w.year, 1, w.source),
    )
    ctx.con.execute(
        "INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, circa, "
        "source_id) VALUES ('work', ?, 'composition', 'scholarly', ?, ?, ?, 1, ?)",
        (w.id, "point" if w.date_from == w.date_to else "window", w.date_from, w.date_to, CURATED),
    )
    rows, cites = [], []
    for ord_, sec in enumerate(w.sections, start=1):
        rows.append((w.edition, ord_, sec.cite, None, 1, sec.title, sec.html, sec.text))
        for osis, _in_note, snippet in sec.refs:  # Whiston's notes: the editor's cross-references
            for one in osis.split():
                span = resolver.resolve(one)
                if span:
                    cites.append((*span, w.id, w.edition, ord_, sec.cite, w.author, w.date_to, "comment",
                                  snippet or None, w.source))  # fmt: skip
    ctx.insert("work_section", ["edition_id", "ord", "cite", "parent_ord", "level", "title", "html", "text"], rows)
    _insert_citations(ctx, cites)
    return len(rows)


def _insert_citations(ctx: Context, rows: list[tuple[Any, ...]]) -> None:
    cols = ["start_vkey", "end_vkey", "work_id", "edition_id", "section_ord", "cite", "author_id", "year", "kind",
            "snippet", "source_id"]  # fmt: skip
    ctx.insert("citation", cols, rows)


def _era(year: int) -> str:
    return "apostolic" if year < 150 else "ante-nicene"


def _links(ctx: Context) -> int:
    """Curated parallels between these writers and the Bible (shown in the study panel's Links tab)."""
    sections: dict[str, list[tuple[str, int, str, int | None]]] = {}
    for wid, edition, cite, ord_, year in ctx.con.execute(
        "SELECT w.id, s.edition_id, s.cite, s.ord, w.date_to FROM work w JOIN work_edition e ON e.work_id = w.id "
        "JOIN work_section s ON s.edition_id = e.id WHERE w.category IN ('jewish', 'pagan')"
    ):
        sections.setdefault(wid, []).append((edition, ord_, cite or "", year))
    authors = dict(ctx.con.execute("SELECT id, author_id FROM work WHERE category IN ('jewish', 'pagan')").fetchall())
    rows = []
    for link in read_csv("witness_links.csv", ("work_id", "cite", "ref")):
        secs = sections.get(link["work_id"])
        if not secs:
            ctx.log.warning("witness_links.csv: %s is not in this build", link["work_id"])
            continue
        # the section whose cite is the longest dotted prefix of the passage ('18.3' for '18.3.3')
        best = max(
            (s for s in secs if link["cite"] == s[2] or link["cite"].startswith(s[2] + ".")),
            key=lambda s: len(s[2]),
            default=secs[0] if len(secs) == 1 else None,
        )
        if best is None:
            raise IngestError(f"witness_links.csv: no section of {link['work_id']} for {link['cite']!r}")
        refs = parse_refs(link["ref"])
        if not refs:
            raise IngestError(f"witness_links.csv: cannot parse reference {link['ref']!r}")
        for r in refs:
            rows.append((r.start, r.end, link["work_id"], best[0], best[1], link["cite"], authors[link["work_id"]],
                         best[3], "reference", link["note"] or None, CURATED))  # fmt: skip
    _insert_citations(ctx, rows)
    return len(rows)


@step("witnesses", sources=[JOSEPHUS, TACITUS, ROMAN], requires=["history", "verses"])
def ingest_witnesses(ctx: Context) -> None:
    """Jewish & Roman witnesses: Josephus, Tacitus (Annals), Suetonius, Pliny (10.96–97), Lucian (Peregrine)."""
    resolver = RefResolver(ctx)
    known = {r[0] for r in ctx.con.execute("SELECT id FROM person")}
    works: list[Work] = []
    loaders: list[tuple[str, Callable[[], list[Work]]]] = [
        (JOSEPHUS, lambda: josephus(ctx.find(JOSEPHUS, "josephus-whiston.xml"))),
        (TACITUS, lambda: tacitus(ctx.find(TACITUS, "tacitus-annals-eng.xml"))),
        (ROMAN, lambda: [
            suetonius(ctx.find(ROMAN, "suetonius-thomson-forester.txt")),
            pliny(ctx.find(ROMAN, "pliny-letters-melmoth.txt")),
            lucian(ctx.find(ROMAN, "lucian-fowler-vol4.txt")),
        ]),
    ]  # fmt: skip
    for source, load in loaders:
        if ctx.public and not ctx.source(source).public:
            ctx.log.info("  %s skipped (not cleared for public builds)", source)
            continue
        works.extend(load())
    for w in works:
        if w.author not in known:
            raise IngestError(f"{w.id}: author {w.author!r} missing from curated/people.csv")
        n = _store(ctx, w, resolver)
        ctx.log.info("  %-24s %4d sections", w.id, n)
    ctx.log.info("  %d curated Bible parallels", _links(ctx))
