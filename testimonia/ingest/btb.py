"""Bruhman Translator's Bible (CC BY-SA 4.0): the parts unique to BTB.

* pericope headings (and the parallel passages printed with them)
* words of Jesus (red letters)
* Treasury of Scripture Knowledge notes
* "Scripture quoting Scripture" links (NT use of the OT, via the LXX)
* the topical concordance
* BTB's chronology for every verse (era, period, approximate date, reading order)
* lexicon articles: Abbott-Smith, LSJ, BDB

Not used: BTB's LXX (Apostolic Bible Polyglot — licence under verification) and texts we take
from primary sources (KJV/BSB from eBible, words from STEPBible).
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Any

import yaml

from .. import mdconv
from ..books import BY_OSIS
from ..refs import id_to_key, parse_refs
from .base import Context, IngestError, batched, step

SOURCE = "btb"
_LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
_WIKI = re.compile(r"\[\[([^\]|\\]+?)(?:\\?\|([^\]]*))?\]\]")
_FN_DEF = re.compile(r"^\[\^(\d+)\]:\s?(.*)$", re.M)
_VERSE_MARK = re.compile(r"\*\*\[\[([1-4]?[A-Za-z]+\.\d+\.\d+)\|\d+\]\]\*\*|\[\^(\d+)\]")
_PERICOPE_HEAD = re.compile(
    r"\[\[([^\]|]+?)\|⥃\]\]</big></big>\*\*\*(.*?)\*\*\*(?:&emsp;<small><sup>\\\[(.*?)\]</sup></small>)?"
)
LEXICONS = {  # BTB folder → (lexicon id, title, language, year, file prefix)
    "as": ("abbott-smith", "Abbott-Smith, Manual Greek Lexicon of the NT", "grc", 1922, "AS."),
    "lsj": ("lsj", "Liddell–Scott–Jones Greek–English Lexicon", "grc", 1940, "LSJ."),
    "bdb": ("bdb", "Brown–Driver–Briggs Hebrew and English Lexicon", "hbo", 1906, "BDB."),
}


# ------------------------------------------------------------------------------------------- dates

_DATE = re.compile(r"^(?P<before>Before\s+)?~?\s*(?P<ad>AD\s+)?(?P<a>\d+)(?:\s*[–-]\s*(?P<b>\d+))?(?:\s*(?P<bc>BC))?$")


def parse_btb_date(text: str) -> tuple[int | None, int | None, bool]:
    """'~593–571 BC' → (-592, -570, circa); '~AD 27–29' → (27, 29, circa); 'Before ~2166 BC' → (None, -2165, circa).

    Years are astronomical (1 BC = 0). Unparseable text returns (None, None, False).
    """
    t = text.strip()
    m = _DATE.match(t)
    if not m:
        return None, None, False
    a = int(m.group("a"))
    b = int(m.group("b")) if m.group("b") else a
    if m.group("bc"):
        a, b = 1 - a, 1 - b
    start, end = min(a, b), max(a, b)
    circa = "~" in t
    if m.group("before"):
        return None, start, circa
    return start, end, circa


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ------------------------------------------------------------------------------------------- files


def _scalar(raw: str) -> Any:
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1].replace('\\"', '"') if v[0] == '"' else v[1:-1].replace("''", "'")
        return v
    if v in ("true", "false"):
        return v == "true"
    if v.lstrip("-").isdigit():
        return int(v)
    return v


def parse_frontmatter(block: str) -> dict[str, Any]:
    """Minimal parser for BTB's flat front-matter (``key: value`` and ``key:`` + ``- item`` lists).

    ~20x faster than a general YAML parser on 30k+ files; falls back to YAML on anything unusual.
    """
    out: dict[str, Any] = {}
    current: str | None = None
    for line in block.splitlines():
        if not line.strip():
            continue
        if line.startswith("- ") and current is not None:
            lst = out.setdefault(current, [])
            if not isinstance(lst, list):
                raise ValueError("list item under scalar key")
            lst.append(_scalar(line[2:]))
            continue
        key, sep, value = line.partition(":")
        if not sep or line[0].isspace():
            raise ValueError(f"unsupported front-matter line: {line!r}")
        current = key.strip()
        out[current] = _scalar(value) if value.strip() else []
    return out


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            block = text[4:end]
            try:
                fm: Any = parse_frontmatter(block)
            except ValueError:
                try:
                    fm = yaml.load(block, Loader=_LOADER) or {}
                except yaml.YAMLError:
                    fm = {}
            return (fm if isinstance(fm, dict) else {}), text[end + 5 :]
    return {}, text


def _read_texts(paths: Iterable[Path]) -> Iterator[tuple[Path, str]]:
    """Read many small files concurrently (the work is I/O-bound)."""
    with ThreadPoolExecutor(max_workers=16) as pool:
        yield from zip(paths, pool.map(lambda p: p.read_text(encoding="utf-8"), paths), strict=True)


def _parallel(func: Callable[[list[str]], list[str]], items: list[str], chunk: int = 500) -> list[str]:
    """Run a CPU-bound text transform over items in worker processes, preserving order."""
    if len(items) < chunk * 2:
        return func(items)
    chunks = [items[i : i + chunk] for i in range(0, len(items), chunk)]
    workers = max(1, min(len(chunks), (os.cpu_count() or 2) - 1))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return [html for part in pool.map(func, chunks) for html in part]


def render_blocks(texts: list[str]) -> list[str]:
    return [mdconv.render(t) for t in texts]


def render_inlines(texts: list[str]) -> list[str]:
    return [mdconv.inline(t) for t in texts]


def _markdown_files(root: Path) -> Iterator[Path]:
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.endswith(".md"):
                yield Path(dirpath) / f


def _target(link: str) -> str | None:
    m = _WIKI.search(link or "")
    return m.group(1) if m else None


# ------------------------------------------------------------------------------------------- step


@step("btb", sources=[SOURCE], requires=["verses"])
def ingest_btb(ctx: Context) -> None:
    """BTB pericopes, red letters, TSK notes, OT-in-NT links, topics, chronology and lexicon articles."""
    vault = ctx.paths(SOURCE)[0]
    for sub in ("interlinear", "KJV", "pericope", "concordance", "lexicon"):
        if not (vault / sub).is_dir():
            raise IngestError(f"BTB vault at {vault} lacks '{sub}/' — is it a complete BTB checkout?")
    known = {r[0] for r in ctx.con.execute("SELECT vkey FROM verse")}
    _verses(ctx, vault / "interlinear", known)
    _pericopes(ctx, vault / "pericope")
    _chapters(ctx, vault / "KJV")
    _topics(ctx, vault / "concordance", known)
    _lexicons(ctx, vault / "lexicon")


def _verses(ctx: Context, root: Path, known: set[int]) -> None:
    """Per-verse frontmatter: chronology, red letters, topics; body: scripture-quoting-scripture links."""
    dates, red, topics = [], [], []
    quotes: set[tuple[Any, ...]] = set()
    periods: dict[str, tuple[str, str | None, int]] = {}  # id → (name, parent, first chron order)
    verse_periods = []
    paths = [p for p in _markdown_files(root) if id_to_key(p.stem) is not None]
    for path, text in _read_texts(paths):
        k = id_to_key(path.stem)
        if k is None:
            continue
        fm, body = _split_frontmatter(text)
        order = fm.get("chronological_order")
        order = int(order) if isinstance(order, int) or (isinstance(order, str) and order.isdigit()) else None
        label = str(fm.get("date") or "").strip()
        start, end, _circa = parse_btb_date(label) if label else (None, None, False)
        if label or order is not None:
            dates.append((k, "btb", start, end, label or None, order))
        era, period = str(fm.get("era") or "").strip(), str(fm.get("period") or "").strip()
        if era:
            era_id = f"btb-era:{slug(era)}"
            prev = periods.get(era_id)
            periods[era_id] = (era, None, min(order or 10**9, prev[2] if prev else 10**9))
            verse_periods.append((k, era_id))
            if period:
                pid = f"btb:{slug(period)}"
                prevp = periods.get(pid)
                periods[pid] = (period, era_id, min(order or 10**9, prevp[2] if prevp else 10**9))
                verse_periods.append((k, pid))
        if fm.get("jesus_said"):
            red.append((k,))
        for t in fm.get("topics") or []:
            name = _target(str(t))
            if name and name.startswith("topic "):
                topics.append((f"btb:{name[6:]}", k, k))
        for line in body.splitlines():
            if not line.startswith("> "):
                continue
            forward = "referencing:" in line
            if not forward and "referenced by:" not in line:
                continue
            for m in _WIKI.finditer(line):
                target = m.group(1)
                other = id_to_key(target.removeprefix("LXX."))
                if other is None or other not in known:
                    continue
                if forward:  # this verse quotes `other`
                    quotes.add((k, k, other, other, "quotation", "LXX" if target.startswith("LXX.") else "MT", SOURCE))
                else:  # `other` quotes this verse
                    quotes.add((other, other, k, k, "quotation", None, SOURCE))
    ctx.insert(
        "period",
        ["id", "name", "parent_id", "scope", "sort", "source_id"],
        ((pid, name, parent, "biblical", order, SOURCE) for pid, (name, parent, order) in periods.items()),
    )
    ctx.insert("verse_period", ["vkey", "period_id"], (r for r in verse_periods if r[0] in known), mode="OR IGNORE")
    ctx.insert(
        "verse_date",
        ["vkey", "system_id", "start_year", "end_year", "label", "chron_order"],
        (d for d in dates if d[0] in known),
        mode="OR REPLACE",
    )
    ctx.con.executemany("UPDATE verse SET red_letter = 1 WHERE vkey = ?", (r for r in red if r[0] in known))
    # a link seen from both sides keeps the version that knows the LXX/MT form
    best: dict[tuple[int, int], tuple[Any, ...]] = {}
    for q in sorted(quotes, key=lambda q: q[5] is None):
        best.setdefault((q[0], q[2]), q)
    ctx.insert("quotation", ["src_start", "src_end", "dst_start", "dst_end", "kind", "via", "source_id"], best.values())
    ctx.cache["btb_topic_refs"] = [t for t in topics if t[1] in known]
    # date ranges for each era/period from its verses (BTB chronology)
    ctx.con.execute(
        """INSERT INTO dating (entity_type, entity_id, aspect, system_id, date_kind, start_year, end_year, circa,
                               source_id)
           SELECT 'period', vp.period_id, 'when', 'btb', 'span', min(vd.start_year), max(vd.end_year), 1, ?
           FROM verse_period vp JOIN verse_date vd ON vd.vkey = vp.vkey AND vd.system_id = 'btb'
           WHERE vd.start_year IS NOT NULL OR vd.end_year IS NOT NULL
           GROUP BY vp.period_id""",
        (SOURCE,),
    )
    ctx.log.info(
        "  chronology for %d verses in %d eras/periods; %d red-letter verses; %d OT-in-NT links",
        len(dates),
        len(periods),
        len(red),
        len(best),
    )


def _pericopes(ctx: Context, root: Path) -> None:
    rows = []
    for path, text in _read_texts(list(_markdown_files(root))):
        fm, _ = _split_frontmatter(text)
        keys = [id_to_key(_target(str(v)) or "") for v in fm.get("verses") or []]
        valid = [k for k in keys if k is not None]
        if valid:
            rows.append(("btb-pericope", min(valid), max(valid), 1, str(fm.get("title") or path.stem), SOURCE))
    ctx.insert("heading", ["scheme", "start_vkey", "end_vkey", "level", "title", "source_id"], rows)
    ctx.log.info("  %d pericope headings", len(rows))


def _chapters(ctx: Context, root: Path) -> None:
    """TSK notes from chapter footnotes (anchored to their verse) and pericope parallel passages."""
    notes, xrefs = [], []
    chapter_files = [
        p
        for p in _markdown_files(root)
        if len(p.stem.split(".")) == 2 and p.stem.split(".")[0] in BY_OSIS and p.stem.split(".")[1].isdigit()
    ]
    for path, text in _read_texts(chapter_files):
        book, ch = path.stem.split(".")[0], int(path.stem.split(".")[1])
        _, body = _split_frontmatter(text)
        text_part = body.split("\n[^1]:", 1)[0]
        chapter_key = BY_OSIS[book].order * 1_000_000 + ch * 1_000
        current = chapter_key
        fn_verse: dict[int, int] = {}
        for m in _VERSE_MARK.finditer(text_part):
            if m.group(1):
                current = id_to_key(m.group(1)) or current
            else:
                fn_verse.setdefault(int(m.group(2)), current)
        for m in _FN_DEF.finditer(body):
            n = int(m.group(1))
            notes.append((fn_verse.get(n, chapter_key), n, "tsk", m.group(2).strip(), SOURCE))
        for m in _PERICOPE_HEAD.finditer(body):
            pid, parallels = m.group(1), m.group(3)
            start = id_to_key(pid.split(" ", 1)[0])
            if start is None or not parallels:
                continue
            for label in re.split(r"\s*(?:<big>)?†(?:</big>)?\s*", mdconv.plain(parallels)):
                for r in parse_refs(label):
                    xrefs.append((start, start, r.start, r.end, None, SOURCE))
    html = _parallel(render_inlines, [n[3] for n in notes])
    notes = [(v, n, kind, h, src) for (v, n, kind, _, src), h in zip(notes, html, strict=True)]
    for batch in batched(notes):
        ctx.insert("verse_note", ["vkey", "n", "kind", "body", "source_id"], batch, mode="OR REPLACE")
    ctx.insert("crossref", ["src_start", "src_end", "dst_start", "dst_end", "votes", "source_id"], xrefs)
    ctx.log.info("  %d Treasury of Scripture Knowledge notes; %d pericope parallels", len(notes), len(xrefs))


def _topics(ctx: Context, root: Path, known: set[int]) -> None:
    rows, refs = [], list(ctx.cache.get("btb_topic_refs", []))
    files = sorted(root.glob("topic *.md"))
    texts = dict(_read_texts(files))
    bodies = _parallel(render_blocks, [texts[f] for f in files])
    for path, body in zip(files, bodies, strict=True):
        text = texts[path]
        name = path.stem[6:]
        tid = f"btb:{name}"
        rows.append((tid, name.title() if name.isupper() else name, body, SOURCE))
        for m in _WIKI.finditer(text):
            k = id_to_key(m.group(1))
            if k is not None and k in known:
                refs.append((tid, k, k))
    ctx.insert("topic", ["id", "name", "body", "source_id"], rows)
    ids = {r[0] for r in rows}
    ctx.insert("topic_ref", ["topic_id", "start_vkey", "end_vkey"], (r for r in refs if r[0] in ids), mode="OR IGNORE")
    ctx.log.info("  %d topics, %d topic links", len(rows), len(refs))


def _lexicons(ctx: Context, root: Path) -> None:
    total = 0
    for folder, (lex_id, title, lang, year, prefix) in LEXICONS.items():
        ctx.insert("lexicon", ["id", "title", "language", "year", "source_id"], [(lex_id, title, lang, year, SOURCE)])
        files = [
            p for p in (root / folder).glob(f"{prefix}*.md") if re.match(r"^[GH]\d{4}[A-Za-z]?$", p.stem[len(prefix) :])
        ]
        texts = dict(_read_texts(files))
        bodies = _parallel(render_blocks, [texts[f] for f in files])
        entries = [(lex_id, f.stem[len(prefix) :], None, b) for f, b in zip(files, bodies, strict=True)]
        total += ctx.insert("lexicon_entry", ["lexicon_id", "lemma_id", "headword", "body"], entries, mode="OR IGNORE")
    ctx.log.info("  %d lexicon articles (Abbott-Smith, LSJ, BDB)", total)
