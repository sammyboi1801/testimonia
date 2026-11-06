"""Swete's Septuagint in Greek (First1KGreek TEI/EpiDoc, CC BY-SA 4.0), mapped to hub numbering with TVTMS.

Swete prints Codex Vaticanus (its gaps filled from Alexandrinus or Sinaiticus) in the Septuagint's own
numbering: Psalms 10–147 one behind the Hebrew, Jeremiah's oracles against the nations after 25:13,
Greek Esther with its six additions, the Song of the Three inside Daniel 3. The digital text is read
into (book, chapter, verse, text) rows in that native numbering and mapped with the same TVTMS rules as
Brenton's English Septuagint (``ebible``), so the two line up verse for verse with every other edition;
``edition_verse.native_ref`` keeps Swete's reference wherever it differs from the hub.

What is left out, and why, is listed in ``SKIPPED_WORKS`` and reported in the build log.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from lxml import etree

from .. import versification as V
from ..books import BY_OSIS
from ..refs import vkey
from .base import Context, IngestError, step
from .ebible import TVTMS, load_rules

SOURCE = "lxx-swete"
EDITION = "lxx-swete"
TEI = "{http://www.tei-c.org/ns/1.0}"

#: First1KGreek work (urn:cts:greekLit:tlg0527.tlgNNN) → USFM code of the book, as the TVTMS mapping expects it.
WORKS: dict[str, str] = {
    "tlg001": "GEN",
    "tlg002": "EXO",
    "tlg003": "LEV",
    "tlg004": "NUM",
    "tlg005": "DEU",
    "tlg006": "JOS",
    "tlg008": "JDG",
    "tlg010": "RUT",
    "tlg011": "1SA",  # 1 Kingdoms
    "tlg012": "2SA",
    "tlg013": "1KI",  # 3 Kingdoms
    "tlg014": "2KI",
    "tlg015": "1CH",
    "tlg016": "2CH",
    "tlg017": "1ES",  # Esdras A
    "tlg018": "EZR",  # Esdras B = Ezra 1–10 + Nehemiah as 11–23 (split by map_bible)
    "tlg019": "ESG",  # Greek Esther, additions relabelled by _esther
    "tlg020": "JDT",
    "tlg021": "TOB",
    "tlg023": "1MA",
    "tlg024": "2MA",
    "tlg025": "3MA",
    "tlg026": "4MA",
    "tlg027": "PSA",  # Psalm 151 is chapter 151
    "tlg028": "MAN",  # Odes: only Ode 8, the Prayer of Manasseh (see _odes)
    "tlg029": "PRO",
    "tlg031": "SNG",
    "tlg032": "JOB",
    "tlg033": "WIS",
    "tlg034": "SIR",
    "tlg036": "HOS",
    "tlg037": "AMO",
    "tlg038": "MIC",
    "tlg039": "JOL",
    "tlg040": "OBA",
    "tlg041": "JON",
    "tlg042": "NAM",
    "tlg043": "HAB",
    "tlg044": "ZEP",
    "tlg045": "HAG",
    "tlg046": "ZEC",
    "tlg047": "MAL",
    "tlg048": "ISA",
    "tlg049": "JER",
    "tlg050": "BAR",
    "tlg051": "LAM",
    "tlg052": "LJE",  # Letter of Jeremiah (hub: Baruch 6, as in the KJV Apocrypha)
    "tlg053": "EZK",
    "tlg055": "SUS",  # Theodotion
    "tlg057": "DAN",  # Theodotion, with the Prayer of Azariah and Song of the Three in chapter 3
    "tlg059": "BEL",  # Theodotion
}

#: Works of tlg0527 that are not read, and why.
SKIPPED_WORKS: dict[str, str] = {
    "tlg030": "Ecclesiastes: First1KGreek has no text for it yet",
    "tlg035": "Psalms of Solomon: not part of the hub canon",
    "tlg054": "Susanna (Old Greek): Theodotion's version is used, as in Brenton and the church's Bibles",
    "tlg056": "Daniel (Old Greek): Theodotion's version is used",
    "tlg058": "Bel and the Dragon (Old Greek): Theodotion's version is used",
}

#: Swete's Ode 8 is the Prayer of Manasseh; the other Odes repeat canticles already read in their own books.
PRAYER_OF_MANASSEH_ODE = "8"

#: TVTMS recognises a versification tradition by a chapter's shape ("Leviticus 7 ends at verse 28"). Where the
#: digitisation runs a chapter's last verses into one division, empty placeholders restore that shape; they
#: carry no text and are never stored.
PLACEHOLDERS: dict[tuple[str, str], tuple[str, ...]] = {
    ("LEV", "7"): ("28",),  # 7:27 also holds 7:28 (= Hebrew/English 7:37–38)
    ("PSA", "91"): ("16",),  # 91:15 holds 15–16
    ("PSA", "129"): ("4", "5", "6", "7", "8"),  # 129:3 holds 3–8
}

Place = tuple[str, int, int]  # hub book, chapter, verse


def _block(book: str, ch: str, first: int, last: int, hub_book: str, hub_ch: int, hub_first: int) -> dict[Any, Place]:
    return {(book, ch, str(v)): (hub_book, hub_ch, hub_first + v - first) for v in range(first, last + 1)}


#: Verses placed by hand where TVTMS has no rule for Swete's order or cannot recognise it:
#: (book, chapter, verse as printed) → hub verse. A verse placed on a hub verse that already has text joins it.
DIRECT: dict[tuple[str, str, str], Place] = {
    # LXX Psalm 12 = Psalm 13 with its title as verse 1. TVTMS tells this tradition from the others by
    # comparing the lengths of verses 4 and 5, which are equally long in Swete, so no rule applies.
    **_block("PSA", "12", 1, 6, "Ps", 13, 0),
    # Malachi 4:4–6 in the Greek order (Elijah; the hearts of the fathers; remember the law of Moses).
    # TVTMS's expanded 'Greek' rules for these verses are the inverse of its own condensed table.
    ("MAL", "4", "4"): ("Mal", 4, 5),
    ("MAL", "4", "5"): ("Mal", 4, 6),
    ("MAL", "4", "6"): ("Mal", 4, 4),
    # Proverbs in the Greek order, which TVTMS does not cover: after 24:22a–e come Agur (30:1–14), the
    # further sayings of the wise (24:23–34), the rest of Agur (30:15–33) and Lemuel (31:1–9); the capable
    # wife (31:10–31) follows 29:27.
    **_block("PRO", "24", 24, 37, "Prov", 30, 1),
    **_block("PRO", "24", 38, 49, "Prov", 24, 23),
    **_block("PRO", "24", 50, 68, "Prov", 30, 15),
    **_block("PRO", "24", 69, 77, "Prov", 31, 1),
    **_block("PRO", "29", 28, 49, "Prov", 31, 10),
    # Sirach: First1KGreek labels 30:25 '13b', and numbers 33:16b–31 as 25–40.
    ("SIR", "30", "13b"): ("Sir", 30, 25),
    **_block("SIR", "33", 25, 40, "Sir", 33, 16),
    # Wisdom 5:1 begins on the last line of Swete's chapter 4.
    ("WIS", "4", "21"): ("Wis", 5, 1),
}

Verse = tuple[str, str, str]  # (chapter, verse label, text) in Swete's numbering
Row = tuple[str, str, str, str]  # (USFM book, chapter, verse label, text) for versification.map_bible

_LB = "\x00"  # line-break marker while flattening (lets words hyphenated across lines be rejoined)
_SKIP = frozenset({"note", "head", "del", "gap", "pb", "milestone", "figure"})  # apparatus, sigla, page furniture


# ----------------------------------------------------------------------------- text


def _local(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _is_verse(el: etree._Element) -> bool:
    return _local(el.tag) == "div" and el.get("subtype") == "verse"


def _walk(el: etree._Element, text: Callable[[str], None], verse: Callable[[etree._Element], None]) -> None:
    """Emit the running text of ``el`` in document order; verse divisions are handed to ``verse`` whole."""
    for child in el:
        name = _local(child.tag)
        if _is_verse(child):
            verse(child)
        elif name == "lb":
            text(_LB)
        elif name and name not in _SKIP:
            if name in ("l", "p", "lg"):
                text(" ")
            if child.text:
                text(child.text)
            _walk(child, text, verse)
        if child.tail:
            text(child.tail)


def _flatten(el: etree._Element) -> str:
    parts: list[str] = [el.text or ""]
    _walk(el, parts.append, lambda v: parts.append(_flatten(v)))
    return "".join(parts)


_HYPHENATED = re.compile(r"(?<=[^\W\d_])-\s*\x00\s*")
_BROKEN_WORD = re.compile(r"(?<=[Ͱ-Ͽἀ-῿])- (?=[α-ωά-ώἀ-ᾯὰ-ῷ])")  # 'ἀνο- μίαν' → 'ἀνομίαν'
_ARTEFACTS = re.compile(
    r"U\+[0-9A-F]{4,5}\w*"  # 'U+05D0' (Sinaiticus siglum) leaked from the apparatus encoding
    r"|[(⁽][^()⁽⁾Ͱ-Ͽἀ-῿]*[)⁾]"  # '(10)', '(??)', '( b)': verse numbers and marks in brackets
    r"|[\d¹²³⁰⁴-⁹]+(?:\s*[—–-]\s*\d+)?"  # line and verse numbers, footnote marks
    r"|[ᴬ-ᶿªº]"  # superscript letters (apparatus sigla)
    r"|[§¶|†‡*?\"/\\<>^£√¨°«»+=_~‘\[\]⁽⁾]"  # stray symbols; Swete's [supplement] brackets are dropped, not the text
    r"|[\x00-\x08\x0b-\x1f\x7f-\x9f]"  # control characters
)
_LATIN = re.compile(r"[A-Za-z]")
_GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
#: Latin capitals that are Greek capitals misread by OCR ('ΚAI' → 'ΚΑΙ').
_HOMOGLYPHS = str.maketrans("ABEZHIKMNOPTYXabeiko", "ΑΒΕΖΗΙΚΜΝΟΡΤΥΧαβεικο")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:·])")


def _fix_token(tok: str) -> str:
    if not _LATIN.search(tok):
        return tok
    greek = [c for c in tok if _GREEK.match(c)]
    if not greek:
        return "" if re.fullmatch(r"[A-Za-z.,:;']+", tok) else tok  # a stray siglum ('B', 'AR', 'V.')
    if all(c.isupper() for c in greek if c.isalpha()):
        return tok.translate(_HOMOGLYPHS)  # a word in capitals with Latin look-alikes
    return _LATIN.sub("", tok)  # a siglum glued to a Greek word ('τὸνB')


def clean(raw: str) -> str:
    """Flattened TEI text → plain Greek: rejoin hyphenated words, drop OCR artefacts, normalise spacing."""
    t = _HYPHENATED.sub("", raw).replace(_LB, " ").replace("•", "·")
    t = _BROKEN_WORD.sub("", t)
    t = unicodedata.normalize("NFC", t)
    t = "".join(c for c in t if not unicodedata.combining(c))  # marks that compose with nothing are OCR noise
    t = _ARTEFACTS.sub(" ", t)
    t = " ".join(filter(None, (_fix_token(tok) for tok in t.split())))
    return _SPACE_BEFORE_PUNCT.sub(r"\1", t).strip()


# ----------------------------------------------------------------------------- TEI


def read_tei(path: Path) -> list[Verse]:
    """One First1KGreek file → its verses in reading order, with Swete's chapter and verse labels.

    Text standing in a chapter before its first verse (a Psalm's title) opens verse 1; text after a
    verse, and pseudo-verses such as Isaiah 32 'head', run on from the verse before.
    """
    body = etree.parse(str(path)).find(f".//{TEI}div[@type='edition']")
    if body is None:
        raise IngestError(f"{path.name}: no edition division")
    chapters = [c for c in body if _local(c.tag) == "div" and c.get("subtype") == "chapter"]
    out: list[list[str]] = []
    for chapter in chapters or [body]:  # the Letter of Jeremiah has verses but no chapters
        ch = (chapter.get("n") or "1").strip() if chapters else "1"
        pending: list[str] = [chapter.text or ""]
        first = len(out)

        def text(s: str, first: int = first, pending: list[str] = pending) -> None:
            if len(out) > first:
                out[-1][2] += s
            else:
                pending.append(s)

        def verse(el: etree._Element, ch: str = ch, first: int = first, pending: list[str] = pending) -> None:
            label = (el.get("n") or "").strip()
            body_text = _flatten(el)
            if not label[:1].isdigit():
                if out:
                    out[-1][2] += " " + body_text
                return
            if len(out) == first:
                body_text = "".join(pending) + " " + body_text
                pending.clear()
            out.append([ch, label, body_text])

        _walk(chapter, text, verse)
    return [(ch, label, clean(t)) for ch, label, t in out if clean(t)]


def swete_file(folder: Path, work: str) -> Path | None:
    """The file of a work that holds Swete's text (Sirach and Isaiah also carry other editions)."""
    for path in sorted((folder / work).glob(f"tlg0527.{work}.1st1K-grc*.xml")):
        with path.open(encoding="utf-8") as fh:
            if "Swete" in fh.read(12_000):
                return path
    return None


# ----------------------------------------------------------------------------- book-specific numbering


def _esther(verses: list[Verse]) -> tuple[list[Verse], list[Verse]]:
    """Swete's Greek Esther → TVTMS's lettered-addition convention (chapters A–E, Göttingen verse numbers).

    Swete prints Addition A as a 'prologue', B, C and E as lettered verses after 3:13, 4:17 and 8:12
    ('1a'…), D as '1b'… after C, and letters the canonical 10:1–3 ('1a'–'3a') ahead of Addition F (1–11).
    Returns (verses for TVTMS, Addition F) — TVTMS's own rules for F cannot fire (their tests ask for
    Esther 10 to end at verse 13 while verse 4 is absent), so F is placed directly by ``addition_f``.
    """
    out: list[Verse] = []
    f: list[Verse] = []
    seq: dict[str, int] = defaultdict(int)
    for ch, label, text in verses:
        lettered = not label.isdigit()
        block = ""
        if ch == "prologue":
            block = "A"
        elif ch == "3" and lettered:
            block = "B"
        elif ch == "4" and lettered:
            block = "D" if label.endswith("b") else "C"  # C's '11a' is misprinted '1a1' in the file
        elif ch == "8" and lettered:
            block = "E"
        elif ch == "10":
            if lettered:
                out.append(("10", label.rstrip("abc"), text))
            else:
                f.append(("F", label, text))
            continue
        if not block:
            out.append((ch, label, text))
            continue
        seq[block] += 1
        out.append((block, str(seq[block]), text))
    return out, f


def addition_f(verse: str) -> V.HubRef:
    """Addition F 1–10 is KJV Additions to Esther 10:4–13, F 11 (the colophon) is 11:1."""
    n = int(verse)
    return V.HubRef("AddEsth", 10, n + 3) if n <= 10 else V.HubRef("AddEsth", 11, 1)


def _odes(verses: list[Verse]) -> list[Verse]:
    return [("1", label, text) for ch, label, text in verses if ch == PRAYER_OF_MANASSEH_ODE]


def _wisdom(verses: list[Verse]) -> list[Verse]:
    """First1KGreek numbers Wisdom 15–19 as chapters 16–20 (chapter 15 is missing, the rest one too high)."""
    return [(str(int(ch) - 1) if int(ch) > 15 else ch, label, text) for ch, label, text in verses]


def repair_sequence(verses: list[Verse]) -> tuple[list[Verse], int]:
    """Fix OCR-garbled verse numbers that break an otherwise regular run (Psalm 88: 47, '84', 49 → 48).

    A plain verse number is replaced by the one its neighbours imply when the next verse is exactly two
    after the previous one and that number is not used elsewhere in the chapter.
    """
    out = list(verses)
    used: dict[str, set[str]] = defaultdict(set)
    for ch, label, _ in out:
        used[ch].add(label)
    fixed = 0
    for i, (ch, label, text) in enumerate(out):
        if not label.isdigit():
            continue
        prev = int(out[i - 1][1]) if i and out[i - 1][0] == ch and out[i - 1][1].isdigit() else 0
        nxt = out[i + 1][1] if i + 1 < len(out) and out[i + 1][0] == ch else ""
        want = str(prev + 1)
        if int(label) != prev + 1 and nxt == str(prev + 2) and want not in used[ch]:
            out[i] = (ch, want, text)
            used[ch].add(want)
            fixed += 1
    return out, fixed


_CLASSICAL = "abcdefghiklmnopqrstuvwxyz"  # subverse letters skip 'j' (versification closes the gap)


def subverse_labels(verses: list[Verse]) -> tuple[list[Verse], int]:
    """Make verse labels safe for TVTMS: re-letter subverses in reading order ('2:35a'… with OCR slips
    such as '35I' for '35l'), read a lone lettered label with no plain verse ('6:35s') as the plain number,
    and run duplicated labels on into the first occurrence. Returns (verses, number of duplicates merged)."""
    parsed: list[tuple[str, int, bool, str]] = []
    for ch, label, text in verses:
        m = re.match(r"(\d+)(.*)", label)
        if not m:
            continue
        parsed.append((ch, int(m.group(1)), bool(m.group(2)), text))
    plain = {(ch, n) for ch, n, lettered, _ in parsed if not lettered}
    groups: dict[tuple[str, int], int] = defaultdict(int)
    for ch, n, lettered, _ in parsed:
        if lettered:
            groups[(ch, n)] += 1
    out: list[list[str]] = []
    index: dict[tuple[str, str], int] = {}
    seen: dict[tuple[str, int], int] = defaultdict(int)
    merged = 0
    for ch, n, lettered, text in parsed:
        label = str(n)
        if lettered and (groups[(ch, n)] > 1 or (ch, n) in plain):
            seen[(ch, n)] += 1
            label += _CLASSICAL[min(seen[(ch, n)], len(_CLASSICAL)) - 1]
        key = (ch, label)
        if key in index:
            out[index[key]][2] += " " + text
            merged += 1
            continue
        index[key] = len(out)
        out.append([ch, label, text])
    return [(ch, label, text) for ch, label, text in out], merged


# ----------------------------------------------------------------------------- whole edition


def read_septuagint(folder: Path) -> tuple[list[Row], list[V.HubVerse], dict[str, int]]:
    """Every Swete book under ``folder`` (data/tlg0527) → rows for TVTMS, verses placed directly, statistics."""
    rows: list[Row] = []
    direct: list[V.HubVerse] = []
    stats: dict[str, int] = defaultdict(int)
    for work, usfm in WORKS.items():
        path = swete_file(folder, work)
        if path is None:
            raise IngestError(f"{SOURCE}: no Swete text for {work} ({usfm}) in {folder}")
        verses = read_tei(path)
        stats["read"] += len(verses)
        if usfm == "ESG":
            verses, f = _esther(verses)
            direct += [V.HubVerse(addition_f(v), t, [f"Esth.F.{v}"], "=") for _, v, t in f]
        elif usfm == "MAN":
            stats["odes_skipped"] += len(verses)
            verses = _odes(verses)
            stats["odes_skipped"] -= len(verses)
        elif usfm == "WIS":
            verses = _wisdom(verses)
        osis = V.STEP_TO_OSIS[V.norm_book(V.USFM_TO_STEP[usfm])]
        kept: list[Verse] = []
        for ch, label, text in verses:
            place = DIRECT.get((usfm, ch, label))
            if place:
                direct.append(V.HubVerse(V.HubRef(*place), text, [f"{osis}.{ch}.{label}"], "="))
            else:
                kept.append((ch, label, text))
        verses, fixed = repair_sequence(kept)
        stats["verse_numbers_repaired"] += fixed
        verses, merged = subverse_labels(verses)
        stats["duplicate_labels_merged"] += merged
        rows += [(usfm, ch, label, text) for ch, label, text in verses]
        for (book_code, ch), labels in PLACEHOLDERS.items():
            if book_code == usfm:
                rows += [(usfm, ch, label, "") for label in labels]
    for work in SKIPPED_WORKS:
        path = swete_file(folder, work)
        if path is not None:
            stats["skipped_work_verses"] += len(read_tei(path))
    return rows, direct, dict(stats)


def _native_key(native: str) -> tuple[str, str, int] | None:
    m = re.match(r"^([^.]+)\.([^.]+)\.(\d+)", native)
    return (m.group(1), m.group(2), int(m.group(3))) if m else None


def unplaced(rows: Iterable[Row], verses: Iterable[V.HubVerse]) -> dict[str, list[str]]:
    """Native verses (by book) that no hub verse carries — for the coverage report."""
    placed = {k for hv in verses for n in hv.native if (k := _native_key(n))}
    missing: dict[str, list[str]] = defaultdict(list)
    for usfm, ch, label, text in rows:
        if not text:
            continue  # a placeholder
        osis = V.STEP_TO_OSIS[V.norm_book(V.USFM_TO_STEP[usfm])]
        if usfm == "EZR" and ch.isdigit() and int(ch) > 10:
            osis, ch = "Neh", str(int(ch) - 10)
        chapter = ch if ch.isdigit() else ch.upper()
        verse = int(re.match(r"\d+", label).group(0))  # type: ignore[union-attr]
        if (osis, chapter, verse) not in placed:
            missing[osis].append(f"{chapter}:{label}")
    return dict(missing)


def map_septuagint(
    rules: V.Rules, rows: list[Row], direct: list[V.HubVerse]
) -> tuple[list[V.HubVerse], dict[str, int]]:
    """TVTMS mapping of the rows plus the directly placed verses, in hub order. A direct verse landing on a
    hub verse that already has text joins it, both parts in Swete's reading order."""
    verses, stats = V.map_bible(rules, rows)
    by_hub = {hv.hub: hv for hv in verses}
    for hv in direct:
        have = by_hub.get(hv.hub)
        if have is None:
            by_hub[hv.hub] = hv
            continue
        parts = sorted(
            [*zip(have.native, [have.text] + [""] * (len(have.native) - 1), strict=True), (hv.native[0], hv.text)],
            key=lambda p: _reading_key(p[0]),
        )
        have.native = [n for n, _ in parts]
        have.text = " ".join(t for _, t in parts if t)
        have.relation = "part"
    out = sorted(by_hub.values(), key=lambda h: (BY_OSIS[h.hub.book].order, h.hub.ch, h.hub.v))
    return out, stats


def _reading_key(native: str) -> tuple[int, int, str]:
    """'Wis.4.21' → (4, 21, ''): orders native references of one book."""
    m = re.match(r"^[^.]+\.(\d+)\.(\d+)(\w*)", native)
    return (int(m.group(1)), int(m.group(2)), m.group(3)) if m else (0, 0, native)


@step("septuagint", sources=[SOURCE, TVTMS], requires=["curated"])
def ingest_septuagint(ctx: Context) -> None:
    """Swete's Greek Septuagint (First1KGreek), mapped to the hub numbering with TVTMS like Brenton."""
    folder = ctx.find(SOURCE, "tlg0527")
    rows, direct, read_stats = read_septuagint(folder)
    verses, stats = map_septuagint(load_rules(ctx), rows, direct)
    ctx.insert(
        "edition",
        [
            "id",
            "title",
            "abbrev",
            "language",
            "script_dir",
            "kind",
            "testament",
            "versification_id",
            "year",
            "base_text",
            "description",
            "sort",
            "source_id",
        ],
        [
            (
                EDITION,
                "Septuagint (Swete)",
                "LXX",
                "grc",
                "ltr",
                "reading_text",
                "OT",
                "lxx",
                1905,
                "LXX",
                "The Old Testament in Greek according to the Septuagint, ed. H. B. Swete (Cambridge; digitised "
                "from the 1896–1905 printings): Codex Vaticanus, its gaps supplied from Alexandrinus or Sinaiticus. "
                "Daniel, Susanna and Bel in Theodotion's version; no Ecclesiastes yet. Digital text: First1KGreek "
                "(Open Greek and Latin). Swete's (Septuagint) verse numbers are kept where they differ.",
                31,
                SOURCE,
            )
        ],
    )
    out = []
    for hv in verses:
        if not hv.text:
            continue
        native = ",".join(hv.native)
        out.append(
            (EDITION, vkey(hv.hub.book, hv.hub.ch, hv.hub.v), native if native != hv.hub.osis else None, hv.text)
        )
    n = ctx.insert("edition_verse", ["edition_id", "vkey", "native_ref", "text"], out)
    missing = unplaced(rows, verses)
    ctx.log.info(
        "  %-9s %6d hub verses from %d Swete verses (%d renumbered by TVTMS, %d merged into a neighbour, "
        "%d placed directly: Esther's Addition F and the DIRECT table)",
        EDITION,
        n,
        read_stats.get("read", 0),
        stats.get("rule", 0),
        sum(1 for hv in verses if len(hv.native) > 1),
        len(direct),
    )
    lost = sum(len(v) for v in missing.values())
    if lost:
        detail = "; ".join(f"{b} {len(v)} ({', '.join(v[:4])}{'…' if len(v) > 4 else ''})" for b, v in missing.items())
        ctx.log.warning("  %s: %d native verses could not be placed: %s", EDITION, lost, detail)
    skipped = ", ".join(f"{w} {why.split(':')[0]}" for w, why in SKIPPED_WORKS.items())
    ctx.log.info(
        "  not read: %s (%d verses); %d other Odes; %d duplicated labels merged",
        skipped,
        read_stats.get("skipped_work_verses", 0),
        read_stats.get("odes_skipped", 0),
        read_stats.get("duplicate_labels_merged", 0),
    )
