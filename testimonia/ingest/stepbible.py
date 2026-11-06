"""STEPBible data (Tyndale House, CC BY 4.0): lexicons, morphology codes, and the word-level
Greek NT (TAGNT) and Hebrew OT (TAHOT) with edition- and manuscript-level variants.

Licensing note: TAGNT records which printed editions (NA27/28, SBL, THGNT, WH, Tregelles, TR,
Byzantine) contain each word. We store that membership per word, as STEPBible publishes it,
but never reassemble a standalone NA27/NA28 text from it.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..books import BY_OSIS
from ..refs import vkey
from ..versification import STEP_TO_OSIS
from .base import Context, IngestError, batched, step

Witness = tuple[str, str, str | None]  # (witness_type, witness_id, qualifier)
Reading = tuple[str, str | None, list[Witness]]  # (text, gloss, witnesses)
UnitInfo = dict[str, Any]
Row = tuple[Any, ...]

LEX = "stepbible-lexicons"
TAGNT = "stepbible-tagnt"
TAHOT = "stepbible-tahot"
FOLDER = "Translators Amalgamated OT+NT"

#: The eight printed Greek editions TAGNT tracks.
GREEK_EDITIONS = ("NA28", "NA27", "Tyn", "SBL", "WH", "Treg", "TR", "Byz")
EDITION_NAMES = {
    "NA28": "Nestle-Aland 28th ed. (2012)",
    "NA27": "Nestle-Aland 27th ed. (1993)",
    "Tyn": "Tyndale House GNT (2017)",
    "SBL": "SBL Greek New Testament (2010)",
    "WH": "Westcott & Hort (1881)",
    "Treg": "Tregelles (1857–79)",
    "TR": "Textus Receptus (Scrivener 1894)",
    "Byz": "Byzantine Text (Robinson-Pierpont 2005)",
}
#: TAHOT variant source letters → (witness_type, witness_id, qualifier).
HEBREW_WITNESSES = {
    "L": ("manuscript", "HEB:Leningrad", None),
    "K": ("manuscript", "HEB:Leningrad", "ketiv"),
    "Q": ("manuscript", "HEB:Leningrad", "qere"),
    "A": ("manuscript", "HEB:Aleppo", None),
    "B": ("edition", "BHS", None),
    "C": ("manuscript", "HEB:Cairensis", None),
    "D": ("manuscript", "DSS", None),
    "H": ("edition", "BenChaim", None),
    "S": ("edition", "ScribalTradition", None),
    "V": ("manuscript", "HEB:other", None),
    "X": ("version", "LXX", None),
    "R": ("edition", "Restored", None),
}

_REF = re.compile(r"^([1-4]?[A-Za-z]{2,3})\.(\d+)\.(\d+)(?:\(([^)]*)\))?#(\d+)=(.+)$")


@dataclass(frozen=True)
class WordRef:
    book: str  # OSIS
    ch: int
    v: int
    word: int
    type: str
    native: str | None


def parse_word_ref(text: str) -> WordRef | None:
    m = _REF.match(text.strip())
    if not m:
        return None
    osis = STEP_TO_OSIS.get(m.group(1).lower())
    if osis is None or osis not in BY_OSIS:
        return None
    native = f"{osis}.{m.group(4)}" if m.group(4) else None
    return WordRef(osis, int(m.group(2)), int(m.group(3)), int(m.group(5)), m.group(6).strip(), native)


def normalize(text: str) -> str:
    """Accent/point-stripped lowercase form for search: 'Θεὸν' → 'θεον', 'בְּרֵאשִׁית' → 'בראשית'."""
    decomposed = unicodedata.normalize("NFD", text)
    base = "".join(c for c in decomposed if not unicodedata.combining(c))
    base = re.sub(r"[^\w֐-׿]", "", base)  # drop punctuation, keep Hebrew letters
    return unicodedata.normalize("NFC", base).lower()


def _data_rows(path: Path) -> Iterator[list[str]]:
    with path.open(encoding="utf-8-sig") as fh:
        for line in fh:
            if line.startswith(("#", " ", "\t")) or "#" not in line.split("\t", 1)[0]:
                continue
            yield line.rstrip("\n").split("\t")


def _files(ctx: Context, source: str, prefix: str) -> list[Path]:
    folder = ctx.find(source, FOLDER)
    files = sorted(folder.glob(f"{prefix} *.txt"))
    if not files:
        raise IngestError(f"no {prefix} files in {folder}")
    return files


_EDITION_TAG = re.compile(r"^(NA28|NA27|Tyn|SBL|WH|Treg|TR|Byz)(\d*)$")


@dataclass(frozen=True)
class Editions:
    """A TAGNT edition list such as 'NA28+NA27+Tyn+SBL+WH²+Treg²+TR+Byz+014'."""

    base: tuple[str, ...]  # printed editions containing the word ('WH²' → 'WH')
    reordered: tuple[str, ...]  # editions where the word stands in a different position (had a marker)
    others: tuple[str, ...]  # further witnesses named in the list, e.g. manuscript '014', 'KJV'


def parse_editions(text: str) -> Editions:
    base: list[str] = []
    reordered: list[str] = []
    others: list[str] = []
    for part in text.split("+"):
        code = re.sub(r"[^A-Za-z0-9]", "", unicodedata.normalize("NFKC", part))  # '²' → '2'
        if not code:
            continue
        m = _EDITION_TAG.match(code)
        if m:
            if m.group(1) not in base:
                base.append(m.group(1))
            if m.group(2) and m.group(1) not in reordered:
                reordered.append(m.group(1))
        elif code not in others:
            others.append(code)
    return Editions(tuple(base), tuple(reordered), tuple(others))


def _editions(text: str) -> list[str]:
    return list(parse_editions(text).base)


def _other_witness(code: str) -> tuple[str, str, None]:
    return ("manuscript", f"GA:{code}", None) if code.isdigit() else ("edition", code, None)


# ============================================================================== lexicons


@step("stepbible-lexicons", sources=[LEX], requires=["curated"])
def ingest_lexicons(ctx: Context) -> None:
    """Brief lexicons of extended Strong's (TBESG Greek, TBESH Hebrew) and morphology codes."""
    folder = ctx.find(LEX, "Lexicons")
    total = 0
    for code, lang, title in (
        ("TBESG", "grc", "Translators Brief lexicon of Extended Strongs for Greek"),
        ("TBESH", "hbo", "Translators Brief lexicon of Extended Strongs for Hebrew"),
    ):
        path = next(folder.glob(f"{code}*.txt"), None)
        if path is None:
            raise IngestError(f"{code} lexicon not found in {folder}")
        lex_id = code.lower()
        ctx.insert("lexicon", ["id", "title", "language", "year", "source_id"], [(lex_id, title, lang, 2024, LEX)])
        lemmas: dict[str, tuple[str, ...]] = {}
        entries: list[tuple[str, str, str, str]] = []
        with path.open(encoding="utf-8-sig") as fh:
            for line in fh:
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 8 or not re.match(r"^[GH]\d{4}", cols[0]):
                    continue
                ext = cols[1].split("=")[0].strip() or cols[0].strip()
                if not re.match(r"^[GH]\d{4}[A-Za-z]?$", ext):
                    continue
                lemma, translit, morph, gloss, definition = cols[3], cols[4], cols[5], cols[6], cols[7]
                language = "arc" if ":" in morph and morph.split(":")[0] == "A" else lang
                if ext not in lemmas:
                    lemmas[ext] = (
                        ext,
                        language,
                        lemma.strip(),
                        translit.strip(),
                        gloss.strip(),
                        _first_sense(definition),
                    )
                    entries.append((lex_id, ext, lemma.strip(), definition.strip()))
        total += ctx.insert(
            "lemma",
            ["id", "language", "lemma", "translit", "gloss", "definition", "source_id"],
            ((*v, LEX) for v in lemmas.values()),
            mode="OR IGNORE",
        )
        total += ctx.insert("lexicon_entry", ["lexicon_id", "lemma_id", "headword", "body"], entries, mode="OR IGNORE")
    total += _morph_codes(ctx)
    ctx.log.info("  %d lexicon rows", total)


def _first_sense(definition: str) -> str:
    text = re.sub(r"<[^>]+>", " ", definition)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:200]


def _morph_codes(ctx: Context) -> int:
    folder = ctx.find(LEX, "Morphology codes")
    rows = []
    for prefix, scheme in (("TEGMC", "step-greek"), ("TEHMC", "step-hebrew")):
        path = next(folder.glob(f"{prefix}*.txt"), None)
        if path is None:
            raise IngestError(f"{prefix} not found in {folder}")
        block: list[str] = []
        for line in [*path.read_text(encoding="utf-8-sig").splitlines(), "$"]:
            if line.strip() == "$":
                if block and "\t" in block[0] and "Function=" in block[0]:
                    code, features = block[0].split("\t", 1)
                    f = dict(
                        (k.strip().lower(), v.split("(")[0].strip())
                        for k, _, v in (p.partition("=") for p in features.split(";"))
                        if v
                    )
                    desc = next((b.strip().strip('"') for b in block[1:] if b.strip()), features)
                    rows.append(
                        (
                            scheme,
                            code.strip(),
                            f.get("function"),
                            f.get("person"),
                            f.get("tense"),
                            f.get("voice"),
                            f.get("mood"),
                            f.get("case"),
                            f.get("number"),
                            f.get("gender"),
                            f.get("state"),
                            f.get("stem"),
                            desc,
                        )
                    )
                block = []
            else:
                block.append(line)
    return ctx.insert(
        "morph_code",
        [
            "scheme",
            "code",
            "pos",
            "person",
            "tense",
            "voice",
            "mood",
            '"case"',
            "number",
            "gender",
            "state",
            "stem",
            "description",
        ],
        rows,
        mode="OR IGNORE",
    )


# ============================================================================== TAGNT


def _register_edition(
    ctx: Context,
    edition_id: str,
    title: str,
    language: str,
    testament: str,
    source: str,
    description: str,
    kind: str = "interlinear",
    sort: int = 50,
) -> None:
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
                edition_id,
                title,
                edition_id.upper(),
                language,
                "rtl" if language in ("hbo", "arc") else "ltr",
                kind,
                testament,
                "eng",
                2024,
                None,
                description,
                sort,
                source,
            )
        ],
    )


@step("stepbible-tagnt", sources=[TAGNT], requires=["curated", "stepbible-lexicons"])
def ingest_tagnt(ctx: Context) -> None:
    """Greek NT words (TAGNT) with edition membership, glosses, morphology and variant units."""
    _register_edition(
        ctx,
        "tagnt",
        "Translators Amalgamated Greek NT (word data)",
        "grc",
        "NT",
        TAGNT,
        "Every word found in any of NA28, NA27, THGNT, SBL, WH, Tregelles, TR or Byzantine, tagged with "
        "the editions that contain it. Word data only; not a reading text.",
    )
    tokens: list[Row] = []
    units: list[tuple[UnitInfo, list[Reading]]] = []
    pos: dict[int, int] = {}
    for path in _files(ctx, TAGNT, "TAGNT"):
        for cols in _data_rows(path):
            if len(cols) < 6:
                continue
            ref = parse_word_ref(cols[0])
            if ref is None:
                continue
            k = vkey(ref.book, ref.ch, ref.v)
            pos[k] = pos.get(k, 0) + 1
            greek, _, translit = cols[1].strip().partition(" (")
            translit = translit.rstrip(")")
            strong, _, morph = cols[3].partition("=")
            eds = parse_editions(cols[5])
            meaning = cols[6].strip() if len(cols) > 6 else ""
            spelling = cols[7].strip() if len(cols) > 7 else ""
            note = cols[13].strip() if len(cols) > 13 else ""
            tokens.append(
                (
                    "tagnt",
                    k,
                    pos[k],
                    greek.strip(),
                    normalize(greek),
                    strong.strip() or None,
                    strong.strip() or None,
                    morph.strip() or None,
                    translit or None,
                    cols[2].strip() or None,
                    "+".join((*eds.base, *eds.others)),
                    ref.type,
                )
            )
            if meaning or spelling or eds.reordered or set(eds.base) != set(GREEK_EDITIONS):
                units.append(_greek_unit(k, greek.strip(), cols[2].strip(), eds, meaning, spelling, note))
    n = 0
    for batch in batched(tokens):
        n += ctx.insert(
            "token",
            [
                "edition_id",
                "vkey",
                "pos",
                "surface",
                "normalized",
                "lemma_id",
                "strong",
                "morph",
                "translit",
                "gloss",
                "editions",
                "word_type",
            ],
            batch,
        )
    v = _insert_units(ctx, units, "NT", TAGNT)
    ctx.log.info("  %d Greek words, %d variant units", n, v)


def _greek_unit(
    k: int, word: str, gloss: str, eds: Editions, meaning: str, spelling: str, note: str
) -> tuple[UnitInfo, list[Reading]]:
    def wits(codes: Iterable[str]) -> list[Witness]:
        return [("edition", e, None) for e in codes]

    complete = set(eds.base) == set(GREEK_EDITIONS)
    in_place = [e for e in eds.base if e not in eds.reordered]
    readings: list[Reading] = [(word, gloss, wits(in_place) + [_other_witness(o) for o in eds.others])]
    if meaning:
        significance = "meaning"
    elif not complete:
        significance = "omission"
    elif eds.reordered:
        significance = "order"
    else:
        significance = "spelling"
    for alt in filter(None, (a.strip() for a in meaning.split(";"))):
        m = re.match(r"^(\S+)\s*(?:\([^)]*\))?\s*(.*?)\s*-\s*\S+\s+in:\s*(.+)$", alt)
        if m:
            readings.append((m.group(1), m.group(2) or None, wits(_editions(m.group(3)))))
    if not meaning and not complete:
        readings.append(("", None, wits(e for e in GREEK_EDITIONS if e not in eds.base)))
    if eds.reordered:
        readings.append((word, "(in a different position)", wits(eds.reordered)))
    for seg in filter(None, (x.strip() for x in spelling.split(";"))):
        codes, _, form = seg.partition(":")
        if form.strip():
            readings.append((form.strip(), "(spelling)", wits(_editions(codes))))
    readings = [r for r in readings if r[2]]  # never emit a reading nobody attests
    label = " / ".join(r[0] or "—" for r in readings)
    unit = {
        "start": k,
        "label": label[:300],
        "significance": significance,
        "note": re.sub(r"<[^>]+>", "", note).lstrip("v ").strip() or None,
    }
    return unit, readings


def _insert_units(ctx: Context, units: list[tuple[UnitInfo, list[Reading]]], testament: str, source: str) -> int:
    cur = ctx.con.cursor()
    witnesses: list[Row] = []
    readings_rows: list[Row] = []
    for unit, rds in units:
        cur.execute(
            "INSERT INTO variant_unit (start_vkey, end_vkey, testament, label, significance, note, source_id) "
            "VALUES (?,?,?,?,?,?,?)",
            (unit["start"], unit["start"], testament, unit["label"], unit["significance"], unit["note"], source),
        )
        uid = cur.lastrowid
        for n, (text, gloss, wits) in enumerate(rds, start=1):
            readings_rows.append((uid, n, text, gloss, 1 if n == 1 else 0))
            seen: set[tuple[str, str]] = set()  # de-duplicate within a reading only
            for wtype, wid, qual in wits:
                if (wtype, wid) in seen:
                    continue
                seen.add((wtype, wid))
                witnesses.append((uid, n, wtype, wid, qual))
    ctx.insert("variant_reading", ["unit_id", "n", "text", "gloss", "is_preferred"], readings_rows)
    ctx.insert(
        "variant_witness", ["unit_id", "n", "witness_type", "witness_id", "qualifier"], witnesses, mode="OR IGNORE"
    )
    return len(units)


# ============================================================================== TAHOT


@step("stepbible-tahot", sources=[TAHOT], requires=["curated", "stepbible-lexicons"])
def ingest_tahot(ctx: Context) -> None:
    """Hebrew/Aramaic OT words (TAHOT: Leningrad), Ketiv/Qere, manuscript variants, and the WLC reading text."""
    _register_edition(
        ctx,
        "tahot",
        "Translators Amalgamated Hebrew OT (word data)",
        "hbo",
        "OT",
        TAHOT,
        "Leningrad Codex (via WLC) word by word, with Qere/Ketiv and readings from Aleppo, BHS, Cairensis, the "
        "Dead Sea Scrolls and the LXX where recorded.",
    )
    _register_edition(
        ctx,
        "wlc",
        "Westminster Leningrad Codex",
        "hbo",
        "OT",
        TAHOT,
        "Hebrew reading text of the Leningrad Codex (Qere read), assembled from STEPBible TAHOT.",
        kind="reading_text",
        sort=30,
    )
    tokens: list[Row] = []
    verse_words: dict[int, list[str]] = {}
    native_refs: dict[int, str] = {}
    units: list[tuple[UnitInfo, list[Reading]]] = []
    pos: dict[int, int] = {}
    for path in _files(ctx, TAHOT, "TAHOT"):
        for cols in _data_rows(path):
            if len(cols) < 6:
                continue
            ref = parse_word_ref(cols[0])
            if ref is None:
                continue
            k = vkey(ref.book, ref.ch, ref.v)
            pos[k] = pos.get(k, 0) + 1
            raw = cols[1].strip()
            surface = raw.replace("/", "").replace("\\", "")
            strongs = cols[4].strip()
            main = re.search(r"\{([HG]\d{4}[A-Za-z]?)\}", strongs)
            parts = _hebrew_parts(raw, strongs, cols[5].strip())
            tokens.append(
                (
                    "tahot",
                    k,
                    pos[k],
                    surface,
                    normalize(surface),
                    main.group(1) if main else None,
                    " ".join(re.findall(r"[HG]\d{4}[A-Za-z]?", strongs)) or None,
                    cols[5].strip() or None,
                    cols[2].strip() or None,
                    cols[3].strip() or None,
                    json.dumps(parts, ensure_ascii=False),
                    ref.type,
                )
            )
            if not ref.type.startswith("X"):  # X = LXX-retroverted words: not part of the Hebrew text
                verse_words.setdefault(k, []).append(surface)
            if ref.native:
                native_refs[k] = ref.native
            meaning = cols[6].strip() if len(cols) > 6 else ""
            if meaning or "(" in ref.type:
                units.append(_hebrew_unit(k, surface, cols[3].strip(), ref.type, meaning))
    n = 0
    for batch in batched(tokens):
        n += ctx.insert(
            "token",
            [
                "edition_id",
                "vkey",
                "pos",
                "surface",
                "normalized",
                "lemma_id",
                "strong",
                "morph",
                "translit",
                "gloss",
                "parts",
                "word_type",
            ],
            batch,
        )
    texts = [("wlc", k, native_refs.get(k), _join_hebrew(words)) for k, words in verse_words.items()]
    ctx.insert("edition_verse", ["edition_id", "vkey", "native_ref", "text"], texts)
    v = _insert_units(ctx, units, "OT", TAHOT)
    ctx.log.info("  %d Hebrew/Aramaic words, %d verses of WLC text, %d variant units", n, len(texts), v)


def _hebrew_parts(raw: str, strongs: str, grammar: str) -> list[dict[str, str]]:
    forms = re.split(r"[/\\]", raw)
    tags = re.split(r"[/\\]", strongs)
    morphs = grammar.split("/")
    lang = morphs[0][:1] if morphs and morphs[0][:1] in ("H", "A") else ""
    out = []
    for i, form in enumerate(forms):
        tag = tags[i].strip("{} ") if i < len(tags) else ""
        morph = morphs[i] if i < len(morphs) else ""
        if morph and lang and not morph.startswith(lang):
            morph = lang + morph
        out.append({"surface": form, "strong": tag, "morph": morph})
    return out


def _join_hebrew(words: list[str]) -> str:
    out = ""
    for w in words:
        if out and not out.endswith("־"):  # no space after maqaf
            out += " "
        out += w
    return out


_HEB_VARIANT = re.compile(r"([A-Z])\s*=\s*(?:\S+\s+)?\(([^)]*)\)\s*(?:\"([^\"]*)\")?")


def _hebrew_unit(k: int, word: str, gloss: str, word_type: str, meaning: str) -> tuple[UnitInfo, list[Reading]]:
    main = word_type[:1]
    readings: list[Reading] = [(word, gloss, [HEBREW_WITNESSES.get(main, ("edition", main, None))])]
    for m in _HEB_VARIANT.finditer(meaning):
        code, hebrew, alt_gloss = m.group(1), m.group(2).replace("/", "").replace("\\", ""), m.group(3)
        readings.append((hebrew, alt_gloss, [HEBREW_WITNESSES.get(code, ("edition", code, None))]))
    significance = "ketiv-qere" if main == "Q" else "meaning"
    label = " / ".join(r[0] for r in readings)
    return {"start": k, "label": label[:300], "significance": significance, "note": None}, readings
