"""Parse the STEPBible morphology codes stored in token.morph into named grammatical features.

Greek (TAGNT, Robinson-style):  'V-2AAI-3S'  'V-APP-NSM'  'N-NSM-T'  'T-GSF'  'P-1GS'  'S-1SNSM'  'PREP'
Hebrew/Aramaic (TAHOT, OSHB-style, morphemes joined by '/'):  'HVqp3ms'  'HTd/Ncmpa'  'Hc/Vqw3ms'  'ANcbsd/Ta'

`parse(code)` returns a flat dict of lower-case feature names → values, e.g.
{'part': 'verb', 'tense': 'aorist', 'voice': 'passive', 'mood': 'participle', 'case': 'nominative', ...}.
Unknown or partial codes simply yield fewer features; nothing raises.
"""

from __future__ import annotations

import re
from functools import lru_cache

# ----------------------------------------------------------------------------- Greek

GREEK_PART = {
    "V": "verb",
    "N": "noun",
    "A": "adjective",
    "T": "article",
    "P": "pronoun",  # personal
    "R": "pronoun",  # relative
    "D": "pronoun",  # demonstrative
    "C": "pronoun",  # reciprocal
    "F": "pronoun",  # reflexive
    "I": "pronoun",  # interrogative
    "K": "pronoun",  # correlative
    "Q": "pronoun",  # correlative or interrogative
    "X": "pronoun",  # indefinite
    "S": "pronoun",  # possessive
    "ADV": "adverb",
    "CONJ": "conjunction",
    "COND": "conjunction",
    "PREP": "preposition",
    "PRT": "particle",
    "INJ": "interjection",
}
PRONOUN_KIND = {
    "P": "personal",
    "R": "relative",
    "D": "demonstrative",
    "C": "reciprocal",
    "F": "reflexive",
    "I": "interrogative",
    "K": "correlative",
    "Q": "correlative",
    "X": "indefinite",
    "S": "possessive",
}
TENSE = {"P": "present", "I": "imperfect", "F": "future", "A": "aorist", "R": "perfect", "L": "pluperfect"}
VOICE = {
    "A": "active",
    "Q": "active",  # impersonal active
    "M": "middle",
    "D": "middle",  # middle deponent
    "P": "passive",
    "O": "passive",  # passive deponent
    "E": "middle-passive",  # middle or passive
    "N": "middle-passive",  # middle or passive deponent
}
DEPONENT = {"D", "O", "N"}
MOOD = {
    "I": "indicative",
    "S": "subjunctive",
    "O": "optative",
    "M": "imperative",
    "N": "infinitive",
    "P": "participle",
}
CASE = {"N": "nominative", "G": "genitive", "D": "dative", "A": "accusative", "V": "vocative"}
NUMBER = {"S": "singular", "P": "plural"}
GENDER = {"M": "masculine", "F": "feminine", "N": "neuter"}
PERSON = {"1": "1st", "2": "2nd", "3": "3rd"}

_GK_VERB = re.compile(r"^V-(2?)([PIFARL])([AMPEDONQX])([ISOMNP])(?:-(?:([123])([SP])|([NGDAV])([SP])([MFN])))?")
_GK_NOMINAL = re.compile(r"^([123])?([SP](?=[NGDAV][SP]))?([NGDAV])([SP])([MFN])?(?:-|$)")


def _greek(code: str) -> dict[str, str]:
    code = code.split(" + ", 1)[0].strip()  # crasis: 'CONJ + G1565=D-NSM' → the first word
    head = code.split("-", 1)[0]
    part = GREEK_PART.get(head)
    if part is None:
        return {}
    out: dict[str, str] = {"part": part}
    if head == "V":
        m = _GK_VERB.match(code)
        if not m:
            return out
        second, t, v, md, per, num, case, num2, gen = m.groups()
        out["tense"] = TENSE[t]
        if second:
            out["second"] = "yes"  # 2nd aorist / 2nd future… (counted with their tense)
        if v in VOICE:
            out["voice"] = VOICE[v]
        if v in DEPONENT:
            out["deponent"] = "yes"
        out["mood"] = MOOD[md]
        if per:
            out["person"], out["number"] = PERSON[per], NUMBER[num]
        if case:
            out["case"], out["number"], out["gender"] = CASE[case], NUMBER[num2], GENDER[gen]
        return out
    if head in PRONOUN_KIND:
        out["pronoun"] = PRONOUN_KIND[head]
    rest = code.split("-", 1)[1] if "-" in code else ""
    m = _GK_NOMINAL.match(rest)
    if m:
        per, _possessor, case, num, gen = m.groups()
        if per:
            out["person"] = PERSON[per]
        out["case"], out["number"] = CASE[case], NUMBER[num]
        if gen:
            out["gender"] = GENDER[gen]
    elif rest.endswith("I") or rest in {"PRI", "LI", "OI", "NUI"}:
        out["indeclinable"] = "yes"
    return out


# ----------------------------------------------------------------------------- Hebrew & Aramaic

HEB_STEM = {
    "q": "qal", "N": "niphal", "p": "piel", "P": "pual", "h": "hiphil", "H": "hophal", "t": "hithpael",
    "o": "polel", "O": "polal", "r": "hithpolel", "m": "poel", "M": "poal", "k": "palel", "K": "pulal",
    "Q": "qal passive", "l": "pilpel", "L": "polpal", "f": "hithpalpel", "D": "nithpael", "j": "pealal",
    "i": "pilel", "u": "hothpaal", "c": "tiphil", "v": "hishtaphel", "w": "nithpalel", "y": "nithpoel",
    "z": "hithpoel",
}  # fmt: skip
ARAM_STEM = {
    "q": "peal", "Q": "peil", "u": "hithpeel", "p": "pael", "P": "ithpaal", "M": "hithpaal", "a": "aphel",
    "h": "haphel", "s": "saphel", "e": "shaphel", "H": "hophal", "i": "ithpeel", "t": "hishtaphel",
    "v": "ishtaphel", "w": "hithaphel", "o": "polel", "z": "ithpoel", "r": "hithpolel", "f": "hithpalpel",
    "b": "hephal", "c": "tiphel", "m": "poel", "l": "palpel", "L": "ithpalpel", "O": "ithpolel", "G": "ittaphal",
}  # fmt: skip
HEB_FORM = {
    "p": "perfect",
    "q": "sequential perfect",
    "i": "imperfect",
    "w": "sequential imperfect",
    "u": "conjunctive imperfect",
    "h": "cohortative",
    "j": "jussive",
    "v": "imperative",
    "r": "participle",
    "s": "passive participle",
    "a": "infinitive absolute",
    "c": "infinitive construct",
}
HEB_PART = {
    "V": "verb",
    "N": "noun",
    "A": "adjective",
    "P": "pronoun",
    "R": "preposition",
    "C": "conjunction",
    "c": "conjunction",
    "D": "adverb",
    "T": "particle",
    "S": "suffix",
}
HEB_GENDER = {"m": "masculine", "f": "feminine", "c": "common", "b": "common"}
HEB_NUMBER = {"s": "singular", "p": "plural", "d": "dual"}
HEB_STATE = {"a": "absolute", "c": "construct", "d": "determined"}
_HEB_PGN = re.compile(r"^([123])?([mfcb])?([spd])?([acd])?$")
ARTICLE_MORPHEMES = {"Td", "Rd", "Ta"}  # the article, a preposition with the article, the Aramaic emphatic


def _pgn(rest: str, out: dict[str, str]) -> None:
    m = _HEB_PGN.match(rest)
    if not m:
        return
    per, gen, num, state = m.groups()
    if per:
        out["person"] = PERSON[per]
    if gen:
        out["gender"] = HEB_GENDER[gen]
    if num:
        out["number"] = HEB_NUMBER[num]
    if state:
        out["state"] = HEB_STATE[state]


def _hebrew(code: str) -> dict[str, str]:
    aramaic = code[0] == "A"
    segments = [s for s in code[1:].split("/") if s]
    if not segments:
        return {}
    main = next((s for s in segments if s[0] in "VNAP"), segments[0])
    out: dict[str, str] = {"language": "aramaic" if aramaic else "hebrew"}
    part = HEB_PART.get(main[0])
    if part:
        out["part"] = part
    if any(s in ARTICLE_MORPHEMES for s in segments):
        out["article"] = "yes"
    if any(s.startswith("Sp") for s in segments if s is not main):
        out["suffix"] = "yes"
    if main[0] == "V" and len(main) >= 3:
        stems = ARAM_STEM if aramaic else HEB_STEM
        if main[1] in stems:
            out["stem"] = stems[main[1]]
        if main[2] in HEB_FORM:
            out["form"] = HEB_FORM[main[2]]
        rest = main[3:]
        if main[2] in "ac" and rest in HEB_STATE:  # infinitives: only a state letter follows
            out["state"] = HEB_STATE[rest]
        else:
            _pgn(rest, out)
    elif main[0] in "NA" and len(main) >= 2:
        if main[1] == "p":
            out["proper"] = "yes"
        else:
            _pgn(main[2:], out)
    elif main[0] == "P" and len(main) >= 2:
        _pgn(main[2:], out)
    if out.get("state") == "determined":
        out["article"] = "yes"
    return out


# ----------------------------------------------------------------------------- public


@lru_cache(maxsize=8192)
def parse(code: str | None) -> dict[str, str]:
    """Feature dict for one morphology code (Greek or Hebrew/Aramaic); {} when it cannot be read."""
    if not code:
        return {}
    code = code.strip()
    if not code:
        return {}
    if re.match(r"^[HA][A-Za-z]", code) and not code.startswith(("ADV", "A-")):
        return _hebrew(code)
    return _greek(code)


def describe(code: str | None) -> str:
    """Readable parsing: 'aorist passive indicative, 3rd singular'."""
    f = parse(code)
    if not f:
        return code or ""
    if f.get("part") == "verb":
        main = [f.get("stem"), f.get("form"), f.get("tense"), f.get("voice"), f.get("mood")]
        infinitive = "infinitive" in (f.get("form") or "")
        tail = [
            f.get("person"),
            f.get("case"),
            f.get("gender"),
            f.get("number"),
            None if infinitive else f.get("state"),
        ]
    else:
        main = [f.get("pronoun"), "proper noun" if f.get("proper") else f.get("part")]
        person = f"{f['person']} person" if f.get("person") else None
        tail = [person, f.get("case"), f.get("gender"), f.get("number"), f.get("state")]
    words = " ".join(w for w in main if w).replace("middle-passive", "middle/passive")
    rest = " ".join(w for w in tail if w)
    return f"{words}, {rest}" if rest else words


# The features a grammar search may filter on, with the values offered, per language.
FEATURES: dict[str, dict[str, list[str]]] = {
    "grc": {
        "part": ["verb", "noun", "adjective", "article", "pronoun", "preposition", "conjunction", "adverb", "particle"],
        "tense": ["present", "imperfect", "future", "aorist", "perfect", "pluperfect"],
        "voice": ["active", "middle", "passive", "middle-passive"],
        "mood": ["indicative", "subjunctive", "optative", "imperative", "infinitive", "participle"],
        "case": ["nominative", "genitive", "dative", "accusative", "vocative"],
        "person": ["1st", "2nd", "3rd"],
        "number": ["singular", "plural"],
        "gender": ["masculine", "feminine", "neuter"],
    },
    "hbo": {
        "part": ["verb", "noun", "adjective", "pronoun", "preposition", "conjunction", "adverb", "particle"],
        "stem": ["qal", "niphal", "piel", "pual", "hiphil", "hophal", "hithpael", "polel", "poel", "qal passive"],
        "form": list(HEB_FORM.values()),
        "person": ["1st", "2nd", "3rd"],
        "gender": ["masculine", "feminine", "common"],
        "number": ["singular", "plural", "dual"],
        "state": ["absolute", "construct", "determined"],
    },
}


def matches(code: str | None, wanted: dict[str, str]) -> bool:
    """Does this code carry every wanted feature? (voice 'passive' also finds passive deponents, etc.)"""
    f = parse(code)
    return all(f.get(k) == v for k, v in wanted.items())
