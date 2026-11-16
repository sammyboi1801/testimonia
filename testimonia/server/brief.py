"""A word at a glance: its short meaning and the words it comes from, read out of the lexicon entry.

STEPBible's Greek entries (Abbott-Smith's text) open with the headword, the words it is formed from in brackets,
the Septuagint note in square brackets, and then the short meaning:

    μονογενής , -ές (μόνος, γένος), [in LXX: …] only, only begotten ( DCG , ii, 281), of sons …

so the brief is: meaning "only, only begotten", from μόνος + γένος (each linked to its own entry when we have it).
Hebrew entries carry no such line; their brief is the gloss alone.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .store import Store

GREEK_WORD = re.compile(r"[Ͱ-Ͽἀ-῿]+")
PAREN = re.compile(r"\(([^()]*)\)")
#: what may sit beside the Greek words in an origin bracket: "(μόνος, γένος)", "(< οὗτος)", "(cf. ἐκ + βάλλω)"
ORIGIN_FILLER = re.compile(r"[\s,<+;.&]|\b(?:cf|and|fr|from|or|i\.e)\b", re.I)
MAX_SHORT = 70
#: abbreviations whose full stop is not a sentence end
ABBREV = {
    "demonstr",
    "determinative",
    "relat",
    "interrog",
    "indef",
    "subst",
    "absol",
    "trans",
    "intrans",
    "metaph",
    "freq",
}
#: a "meaning" that is only grammar ("demonstr. pron.", "adv.", "prep.")
ABBREV_ONLY = re.compile(r"^(?:[a-z]+\.\s*)+$", re.I)


def fold(word: str) -> str:
    """Greek without accents or breathings, lower case, final sigma as σ: for matching words to lemmas."""
    d = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in d if not unicodedata.combining(c)).replace("ς", "σ")


def parse_entry(text: str) -> tuple[str | None, list[str]]:
    """(short meaning, origin words) from a Greek lexicon entry; either may be missing."""
    t = re.sub(r"<[^>]+>", " ", text or "")
    t = re.sub(r"&lt;", "<", t)
    t = re.sub(r"\s+", " ", t).strip()
    lxx = t.find("[")
    head = t[: lxx if lxx > 0 else 160]
    origin: list[str] = []
    for m in PAREN.finditer(head):
        inside = m.group(1)
        words = GREEK_WORD.findall(inside)
        # "the prepositive article (ἄρθρον προτακτικόν)" names a term; an origin follows the headword itself
        if re.search(r"[A-Za-z]{4,}\s*$", head[: m.start()]):
            continue
        if words and not ORIGIN_FILLER.sub("", GREEK_WORD.sub("", inside)).strip():
            origin = words
            break
    # the meaning follows the Septuagint note "[…]"; without one, it follows the headword's brackets
    if lxx >= 0:
        close = t.find("]", lxx)
        rest = t[close + 1 :] if close > 0 else ""
    else:
        last = list(PAREN.finditer(head))
        rest = t[last[-1].end() :] if last else ""
    rest = rest.lstrip(" ;,:")
    cut = -1
    for stop in (" (", ";", "__", ":", " [", " —", " -- "):
        i = rest.find(stop)
        if i >= 0 and (cut < 0 or i < cut):
            cut = i
    for m in re.finditer(r"(\w+)\. ", rest):  # a sentence end, not an abbreviation ("demonstr. pron.", "Eng.")
        if len(m.group(1)) >= 5 and m.group(1).lower() not in ABBREV and (cut < 0 or m.start() < cut):
            cut = m.end(1)
            break
    if cut < 0:  # no natural end: the entry is cut off here, so its words can't be trusted
        return None, origin
    short = re.sub(r"\s+,", ",", rest[:cut]).strip(" ,.")
    if len(short) > 40 and len(short.split(",")[0]) >= 3:
        short = short.split(",")[0]  # the first sense is the meaning at a glance ("to love")
    if len(short) > MAX_SHORT:
        short = short[:MAX_SHORT].rsplit(" ", 1)[0]
    grammar_only = ABBREV_ONLY.match(short + ".") or re.search(r"\bpron\b", short)
    if not short or len(short) > 45 or GREEK_WORD.search(short) or re.search(r"\d", short) or grammar_only:
        return None, origin
    return short, origin


_INDEX: dict[int, dict[str, str]] = {}


def _greek_index(s: Store) -> dict[str, str]:
    """Folded Greek lemma -> its id (the most frequent one when several share a spelling)."""
    key = id(s)
    if key not in _INDEX:
        best: dict[str, tuple[int, str]] = {}
        for r in s.all("SELECT id, lemma, frequency FROM lemma WHERE language = 'grc' AND lemma IS NOT NULL"):
            k = fold(r["lemma"])
            score = r["frequency"] or 0
            if k not in best or score > best[k][0]:
                best[k] = (score, r["id"])
        _INDEX[key] = {k: v[1] for k, v in best.items()}
    return _INDEX[key]


def briefs(s: Store, ids: list[str]) -> dict[str, dict[str, Any]]:
    """For each lemma id: {short, origin: [{id, lemma}]}."""
    want = sorted({i for i in ids if i})
    if not want:
        return {}
    marks = ",".join("?" * len(want))
    rows = s.all(f"SELECT id, language, lemma, gloss, definition FROM lemma WHERE id IN ({marks})", tuple(want))
    index = _greek_index(s) if any(r["language"] == "grc" for r in rows) else {}
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        short, origin = parse_entry(r["definition"] or "") if r["language"] == "grc" else (None, [])
        roots: list[dict[str, str | None]] = []
        for w in origin:
            rid = index.get(fold(w))
            if rid and rid != r["id"]:
                roots.append({"id": rid, "lemma": w})
            elif not rid:
                roots.append({"id": None, "lemma": w})
        out[r["id"]] = {"short": short or r["gloss"], "origin": roots}
    return out
