"""Reading manuscript transcriptions (edition kind 'manuscript'): their markup as words, as Leiden-style plain text,
and compared with the printed Greek text.

The markup is the light HTML written by :mod:`testimonia.ingest.transcriptions` (word spans ``w``, lost letters
``m``, damaged ``d``, supplied words ``sup``, nomina sacra ``ns``, corrections ``corr`` …).
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from html.parser import HTMLParser

HANDS = {"x": "first hand, before correction", "a": "second hand", "b": "third hand", "c": "fourth hand"}
_WORD_TAG = re.compile(r'<span class="w((?: [a-z]+)*)">')


@dataclass
class MsWord:
    letters: str = ""
    ns: bool = False
    supplied: bool = False
    extant: int = 0  # letters that survive (not lost in a lacuna)


@dataclass
class Reading:
    words: list[MsWord] = field(default_factory=list)
    leiden: str = ""
    absent: bool = False
    gaps: int = 0

    @property
    def letters(self) -> int:
        return sum(len(w.letters) for w in self.words)

    @property
    def extant(self) -> int:
        return sum(w.extant for w in self.words)


class _Walker(HTMLParser):
    """Walks the markup once, collecting words (with what survives of them) and a Leiden-style rendering."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.r = Reading()
        self.stack: list[set[str]] = []
        self.out: list[str] = []
        self.word: MsWord | None = None
        self.corr_note = ""

    def _has(self, cls: str) -> bool:
        return any(cls in s for s in self.stack)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        classes = set((a.get("class") or "").split())
        self.stack.append(classes)
        if "absent" in classes:
            self.r.absent = True
            self.out.append("(verse absent)" if "vid" not in classes else "(verse absent, judged from the space)")
        if "gap" in classes:
            self.r.gaps += 1
            self.out.append(" […]" if self.out and not self.out[-1].endswith(" ") else "[…]")
        if "w" in classes:
            self.word = MsWord(ns="ns" in classes or "num" in classes, supplied="sup" in classes)
            self.r.words.append(self.word)
            if self.word.supplied:
                self.out.append("[")
        if "corr" in classes:
            notes = [
                f"{HANDS[h]}: {_reading(html.unescape(a[f'data-{h}'] or ''))}" for h in HANDS if a.get(f"data-{h}")
            ]
            self.corr_note = "{corr. " + "; ".join(notes) + "}" if notes else ""

    def handle_endtag(self, tag: str) -> None:
        classes = self.stack.pop() if self.stack else set()
        if "w" in classes and self.word is not None:
            if self.word.supplied:
                self.out.append("]")
            self.word = None
        if "corr" in classes and self.corr_note:
            self.out.append(" " + self.corr_note)
            self.corr_note = ""

    def handle_data(self, data: str) -> None:
        if not data.strip():
            if data:
                self.out.append(" ")
            return
        lost = self._has("m") or self._has("sup")
        damaged = self._has("d")
        text = data.replace("¯", "(ν)") if not self._has("nu") else "(ν)"
        if self.word is not None:
            self.word.letters += data.replace("¯", "ν")
            if not lost:
                self.word.extant += len(data)
        if damaged:
            text = "".join(ch + "̣" for ch in text)
        if self.word is not None and self.word.ns:
            text = "".join(ch + "̅" if ch.isalpha() else ch for ch in text)
        if self._has("m") and not self._has("sup"):
            text = f"[{text}]"
        self.out.append(text)


def _reading(text: str) -> str:
    return "(nothing)" if text in ("", "—") else text


def read_markup(markup: str) -> Reading:
    w = _Walker()
    w.feed(markup or "")
    w.close()
    text = "".join(w.out)
    text = text.replace("][", "").replace("] [", " ").replace("[[", "[").replace("]]", "]")
    w.r.leiden = re.sub(r"\s+", " ", text).strip()
    return w.r


# ----------------------------------------------------------------------------- comparison with the printed text


def _bare(word: str) -> str:
    decomposed = unicodedata.normalize("NFD", word.lower())
    base = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^\w⳨]", "", base).replace("ς", "σ").replace("¯", "ν")


def orth(word: str) -> str:
    """A spelling-blind key, so the scribes' usual spellings do not count as differences: ει/ι, αι/ε, ω/ο, double
    letters, and a movable final nu (εἶπεν/εἶπε)."""
    w = _bare(word)
    w = w.replace("ει", "ι").replace("αι", "ε").replace("ω", "ο")
    w = re.sub(r"(.)\1", r"\1", w)
    if len(w) > 3 and w.endswith(("εν", "ιν")):
        w = w[:-1]
    return w


def _ns_fits(ns: str, printed: str) -> bool:
    """A nomen sacrum fits a printed word when it keeps that word's first and last letters, in order (θσ θεός,
    πρσ πατρός, ιηλ Ἰσραήλ, σ⳨ον σταυρόν)."""
    n, p = _bare(ns).replace("⳨", "ταυρ"), _bare(printed)
    if not n or not p or n[0] != p[0] or n[-1] != p[-1]:
        return False
    it = iter(p)
    return all(ch in it for ch in n)


def compare(reading: Reading, printed: list[str]) -> tuple[list[str | None], list[tuple[int, str]]]:
    """Which words of the manuscript differ from the printed text: per manuscript word the printed words it
    stands for when it differs (None when it agrees or is supplied), and printed words the manuscript lacks as
    (position before which they are missing, words). Supplied words and gaps never count as differences."""
    words = reading.words
    pk = [orth(p) for p in printed]
    used: set[int] = set()
    mk: list[str] = []
    for i, w in enumerate(words):
        if w.ns:
            expect = round(i * len(printed) / max(len(words), 1))
            hits = [j for j, p in enumerate(printed) if j not in used and _ns_fits(w.letters, p)]
            if hits:
                j = min(hits, key=lambda j: abs(j - expect))
                used.add(j)
                mk.append(pk[j])
                continue
        mk.append(orth(w.letters))
    marks: list[str | None] = [None] * len(words)
    missing: list[tuple[int, str]] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, mk, pk, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        shown = " ".join(_clean(p) for p in printed[j1:j2])
        if tag in ("replace", "delete"):
            first = True
            for i in range(i1, i2):
                if words[i].supplied:
                    continue
                marks[i] = (shown or "—") if first else "…"
                first = False
        elif tag == "insert":
            near = [words[i] for i in (i1 - 1, i1) if 0 <= i < len(words)]
            if near and not any(w.supplied or w.extant == 0 for w in near):
                missing.append((i1, shown))
    return marks, missing


def _clean(word: str) -> str:
    return re.sub(r"[^\ẁ-ͯἀ-῿]", "", word)


def mark_markup(markup: str, marks: list[str | None], missing: list[tuple[int, str]]) -> str:
    """Add class ``diff`` (with ``data-p``: the printed words) to differing words and ``<span class="om">`` where the
    printed text has words the manuscript lacks."""
    before: dict[int, list[str]] = {}
    for i, words in missing:
        before.setdefault(i, []).append(words)
    count = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal count
        i = count
        count += 1
        tag = m.group(0)
        if i < len(marks) and marks[i] is not None:
            p = html.escape(marks[i] or "", quote=True)
            tag = f'<span class="w{m.group(1)} diff" data-p="{p}">'
        om = "".join(f'<span class="om" data-p="{html.escape(w, quote=True)}"></span>' for w in before.get(i, []))
        return om + tag

    out = _WORD_TAG.sub(sub, markup)
    tail = before.get(count)
    if tail:
        out += "".join(f'<span class="om" data-p="{html.escape(w, quote=True)}"></span>' for w in tail)
    return out
