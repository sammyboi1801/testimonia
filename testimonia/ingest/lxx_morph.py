"""The Septuagint word by word: Swete's text with Morpheus lemmas and parsing (QuantForge LXX, CC BY-SA 4.0).

The tagged files are built on the same First1KGreek transcription as the ``septuagint`` step, in Swete's own
verse numbering. Each word is placed on its hub verse through that step's native references (Wisdom's
chapters 16–20 are 15–19, Esdras B's 11–23 are Nehemiah 1–13), so the words sit under exactly the verse
text the reader sees. Lemmas are matched to the STEPBible Greek lexicon for a gloss and a word study.
Esther's lettered additions (A–F) are numbered differently in the tagged files and are not placed yet.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterator
from itertools import islice
from typing import Any

from .base import Context, step
from .stepbible import normalize

SOURCE = "lxx-morpheus"
EDITION = "lxx"
SCHEME = "lxx-morpheus"

#: tagged-file book → the book prefix the Swete edition's native references use
PREFIX = {
    "1Kgdms": "1Sam",
    "2Kgdms": "2Sam",
    "3Kgdms": "1Kgs",
    "4Kgdms": "2Kgs",
    "2Esd": "Ezra",
    "SusTh": "Sus",
    "DanTh": "Dan",
    "BelTh": "Bel",
}
#: not in the hub text: the Old Greek Daniel group (the reader has Theodotion's), Psalms of Solomon, the Odes
SKIP = {"Sus", "Dan", "Bel", "PssSol", "Odes"}

POS = {
    "A-": "Adjective",
    "C-": "Conjunction",
    "D-": "Adverb",
    "I-": "Interjection",
    "N-": "Noun",
    "NP": "Proper noun",
    "P-": "Preposition",
    "RA": "Article",
    "RD": "Demonstrative pronoun",
    "RI": "Interrogative/indefinite pronoun",
    "RP": "Personal pronoun",
    "RR": "Relative pronoun",
    "V-": "Verb",
    "X-": "Particle",
}
PERSON = {"1": "1st", "2": "2nd", "3": "3rd"}
TENSE = {"P": "Present", "I": "Imperfect", "F": "Future", "A": "Aorist", "X": "Perfect", "Y": "Pluperfect"}
VOICE = {"A": "Active", "M": "Middle", "P": "Passive"}
MOOD = {"I": "Indicative", "D": "Imperative", "S": "Subjunctive", "O": "Optative", "N": "Infinitive", "P": "Participle"}
CASE = {"N": "Nominative", "G": "Genitive", "D": "Dative", "A": "Accusative", "V": "Vocative"}
NUMBER = {"S": "Singular", "P": "Plural", "D": "Dual"}
GENDER = {"M": "Masculine", "F": "Feminine", "N": "Neuter"}
DEGREE = {"C": "Comparative", "S": "Superlative"}


def describe(pos: str, parse: str) -> dict[str, str | None]:
    """'V-', '3AAI-S--' → the morph_code columns and a readable description."""
    p = (parse + "--------")[:8]
    cols = {
        "pos": POS.get(pos, pos),
        "person": PERSON.get(p[0]),
        "tense": TENSE.get(p[1]),
        "voice": VOICE.get(p[2]),
        "mood": MOOD.get(p[3]),
        "case": CASE.get(p[4]),
        "number": NUMBER.get(p[5]),
        "gender": GENDER.get(p[6]),
    }
    parts = [
        cols["pos"],
        cols["tense"],
        cols["voice"],
        cols["mood"],
        cols["person"],
        cols["case"],
        cols["number"],
        cols["gender"],
        DEGREE.get(p[7]),
    ]
    cols["description"] = " ".join(x for x in parts if x)
    return cols


_LATIN = str.maketrans(
    {
        "α": "a",
        "β": "b",
        "γ": "g",
        "δ": "d",
        "ε": "e",
        "ζ": "z",
        "η": "ē",
        "θ": "th",
        "ι": "i",
        "κ": "k",
        "λ": "l",
        "μ": "m",
        "ν": "n",
        "ξ": "x",
        "ο": "o",
        "π": "p",
        "ρ": "r",
        "σ": "s",
        "ς": "s",
        "τ": "t",
        "υ": "y",
        "φ": "ph",
        "χ": "ch",
        "ψ": "ps",
        "ω": "ō",
    }
)


def translit(word: str) -> str:
    """A plain transliteration ('λόγων' → 'logōn'; rough breathing as h)."""
    import unicodedata

    d = unicodedata.normalize("NFD", word)
    rough = "̔" in d[:3]
    base = (
        normalize(word)
        .translate(_LATIN)
        .replace("gg", "ng")
        .replace("gk", "nk")
        .replace("gx", "nx")
        .replace("gch", "nch")
    )
    for a, b in (("ay", "au"), ("ey", "eu"), ("oy", "ou"), ("ēy", "ēu"), ("yi", "ui")):  # υ in a diphthong is u
        base = base.replace(a, b)
    return "h" + base if rough and base[:1] in "aeiouyēō" else base


def _batched(it: Iterator[tuple[Any, ...]], n: int = 5000) -> Iterator[list[tuple[Any, ...]]]:
    while chunk := list(islice(it, n)):
        yield chunk


@step("lxx-morph", sources=[SOURCE], requires=["septuagint", "verses", "stepbible-lexicons"])
def ingest_lxx_morph(ctx: Context) -> None:
    """Septuagint words with lemma, parsing and a lexicon gloss (all books, the deuterocanon included)."""
    data = ctx.find(SOURCE, "data")
    books = {}
    for line in (data / "books.tsv").read_text(encoding="utf-8").splitlines()[1:]:
        code, abbr, *_ = line.split("\t")
        books[int(code)] = abbr

    # Swete's native (book, chapter, verse) → hub verse, as the septuagint step placed them
    native: dict[tuple[str, int, int], int] = {}
    for r in ctx.con.execute(
        "SELECT ev.vkey, ev.native_ref, v.osis FROM edition_verse ev JOIN verse v ON v.vkey = ev.vkey "
        "WHERE ev.edition_id = 'lxx-swete'"
    ):
        for n in (r[1] or r[2]).split(","):
            m = re.match(r"^([^.]+)\.(\d+)\.(\d+)", n)
            if m:
                native.setdefault((m.group(1), int(m.group(2)), int(m.group(3))), r[0])

    # lemma → STEPBible Greek lexicon entry (for the gloss and the word study)
    lex: dict[str, tuple[str, str | None]] = {}
    for lid, lemma, gloss in ctx.con.execute("SELECT id, lemma, gloss FROM lemma WHERE language = 'grc' ORDER BY id"):
        for form in str(lemma).split(","):
            lex.setdefault(normalize(form), (lid, gloss))

    codes: dict[str, dict[str, str | None]] = {}
    placed: Counter[str] = Counter()
    missed: Counter[str] = Counter()
    matched = 0

    def rows() -> Iterator[tuple[Any, ...]]:
        nonlocal matched
        for f in sorted((data / "morph-morpheus").glob("*.txt")):
            abbr = f.stem.split("-", 1)[1]
            if abbr in SKIP:
                continue
            pos_in_verse: Counter[int] = Counter()
            for line in f.read_text(encoding="utf-8").splitlines():
                cols = line.split(" ")
                if len(cols) < 8:
                    continue
                bcv, pos, parse, text, _word, _norm, lemma = cols[:7]
                ch, v = int(bcv[3:6]), int(bcv[6:9])
                pre = PREFIX.get(abbr, abbr)
                if abbr == "Wis" and ch > 15:
                    ch -= 1
                if abbr == "2Esd" and ch > 10:
                    pre, ch = "Neh", ch - 10
                k = native.get((pre, ch, v))
                if k is None:
                    missed[abbr] += 1
                    continue
                placed[abbr] += 1
                pos_in_verse[k] += 1
                code = f"{pos}{parse}"
                if code not in codes:
                    codes[code] = describe(pos, parse)
                hit = lex.get(normalize(re.sub(r"\d+$", "", lemma)))
                matched += hit is not None
                yield (
                    EDITION,
                    k,
                    pos_in_verse[k],
                    text,
                    normalize(text),
                    hit[0] if hit else None,
                    hit[0] if hit else None,
                    code,
                    translit(text),
                    hit[1] if hit else (translit(text).capitalize() if pos == "NP" else None),  # names: the name itself
                )

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
                "Septuagint word by word (Swete, Morpheus)",
                "LXX·w",
                "grc",
                "ltr",
                "interlinear",
                "OT",
                "lxx",
                1905,
                "LXX",
                "Swete's Septuagint, every word with its lemma and parsing (Morpheus, QuantForge LXX) and a gloss from "
                "the STEPBible lexicon: the Greek Old Testament and the deuterocanonical books word by word.",
                33,
                SOURCE,
            )
        ],
    )
    n = 0
    for batch in _batched(rows()):
        n += ctx.insert(
            "token",
            ["edition_id", "vkey", "pos", "surface", "normalized", "lemma_id", "strong", "morph", "translit", "gloss"],
            batch,
        )
    ctx.insert(
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
            "description",
        ],  # case is an SQL keyword,
        [
            (
                SCHEME,
                c,
                d["pos"],
                d["person"],
                d["tense"],
                d["voice"],
                d["mood"],
                d["case"],
                d["number"],
                d["gender"],
                d["description"],
            )
            for c, d in codes.items()
        ],
    )
    lost = ", ".join(f"{b} {m}" for b, m in missed.most_common() if m > 50)
    ctx.log.info(
        "  %d Septuagint words in %d books (%d linked to the lexicon); not placed: %s",
        n,
        len(placed),
        matched,
        lost or "none",
    )
