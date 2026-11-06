"""Clear Bible MACULA (Biblica, CC BY 4.0): semantic domains, word senses and Septuagint equivalents.

MACULA annotates every word of the SBLGNT and of the Westminster Leningrad Codex. We do not add its
words as new tokens: each MACULA word is matched to the STEPBible word (TAGNT / TAHOT) with the same
Strong's number in the same verse (then, for leftovers, in the same chapter), and its data is attached
to that existing token and lemma:

* Greek: the Louw–Nida entry (``LN:33.98``) of each word, grouped under the UBS Semantic Dictionary of
  Biblical Greek subdomains (``SDBG:033006`` "Speak, Talk") and the Louw–Nida domains (``LN:33``).
* Hebrew: the lexical domain of the UBS Semantic Dictionary of Biblical Hebrew (``SDBH:001001001``),
  and the Greek word the Septuagint uses at that place (``token.lxx_equiv``), aggregated per lemma
  into ``entity_link`` rows ``lemma:H… —lxx_equivalent→ lemma:G…`` weighted by the number of places.

Tables: ``semantic_domain`` (the domain trees), ``lemma_sense`` (one row per lemma and domain, with a
gloss), ``token.domain_id`` / ``token.lxx_equiv`` (per word in context, so sense counts and verse
lists come from the tokens), ``lemma.ln`` / ``lemma.sdbh`` and ``entity_link``.
"""

from __future__ import annotations

import csv
import json
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, NamedTuple

from lxml import etree

from ..books import BY_OSIS
from ..refs import vkey
from ..versification import STEP_TO_OSIS, USFM_TO_STEP
from .base import Context, IngestError, batched, step
from .stepbible import normalize

GREEK = "macula-greek"
HEBREW = "macula-hebrew"
LXX_REL = "lxx_equivalent"
GREEK_ALIASES = "macula.greek-aliases"  # build cache: MACULA Greek Strong's → STEPBible's

csv.field_size_limit(1 << 24)


# ----------------------------------------------------------------------------- parsing


@dataclass(frozen=True)
class Word:
    """One MACULA word (Hebrew: one morpheme) that carries a Strong's number."""

    vkey: int  # hub verse key
    strong: str  # base Strong's number: 'G3056', 'H1697'
    lemma: str = ""
    domains: tuple[str, ...] = ()  # semantic domain ids: 'LN:33.98' / 'SDBH:002003003004'
    gloss: str = ""  # contextual English gloss
    lxx: str = ""  # Hebrew only: base Strong's number of the Septuagint's Greek word ('G3056')


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s.strip())


def parse_ref(ref: str) -> tuple[str, int, int] | None:
    """'MAT 1:1!1' → ('Matt', 1, 1)."""
    try:
        book, rest = ref.split(" ", 1)
        ch, v = rest.split("!", 1)[0].split(":")
        step_code = USFM_TO_STEP.get(book.upper())
        osis = STEP_TO_OSIS.get(step_code.lower()) if step_code else None
        if osis is None or osis not in BY_OSIS:
            return None
        return osis, int(ch), int(v)
    except ValueError:
        return None


def base_strong(prefix: str, raw: str) -> str:
    """MACULA Strong's ('0871a', '3056', '5228+1537', '1722|1698') → 'H0871' / 'G3056' ('' when absent)."""
    head = raw.replace("|", "+").split("+", 1)[0].strip()
    digits = "".join(c for c in head if c.isdigit())
    if not digits or int(digits) == 0:
        return ""
    return f"{prefix}{int(digits):04d}"


def _tsv(path: Path) -> Iterator[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        yield from csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE)


def ln_id(ln: str) -> str:
    return f"LN:{ln}"


def sdbg_parent(ln: str, codes: Sequence[str], paired: str = "") -> str:
    """The SDBG subdomain an LN entry belongs to: the code listed at the same position (``paired``) when
    its top-level number agrees, else the first listed code whose top-level number matches."""
    major = ln.split(".", 1)[0]
    if not major.isdigit():
        return ""
    top = f"{int(major):03d}"
    for c in (paired, *codes):
        if len(c) == 6 and c[:3] == top:
            return f"SDBG:{c}"
    return f"LN:{int(major)}"


def parse_greek(path: Path, parents: dict[str, Counter[str]] | None = None) -> Iterator[Word]:
    """Words of macula-greek-SBLGNT.tsv; records each LN entry's SDBG subdomain in ``parents``."""
    for r in _tsv(path):
        where = parse_ref(r.get("ref", ""))
        strong = base_strong("G", r.get("strong", ""))
        if where is None or not strong:
            continue
        codes = r.get("domain", "").split()
        lns = r.get("ln", "").split()
        if parents is not None:
            for i, ln in enumerate(lns):
                parent = sdbg_parent(ln, codes, codes[i] if len(codes) == len(lns) else "")
                if parent:
                    parents.setdefault(ln, Counter())[parent] += 1
        yield Word(
            vkey(*where),
            strong,
            lemma=nfc(r.get("lemma", "")),
            domains=tuple(ln_id(ln) for ln in lns),
            gloss=r.get("english", "").strip(),
        )


def parse_hebrew(path: Path, hub: Callable[[str, int, int], int], labelled: Callable[[str], str]) -> Iterator[Word]:
    """Morphemes of macula-hebrew.tsv. ``hub`` maps a Hebrew-numbered verse to the hub verse key;
    ``labelled`` maps an SDBH code to its nearest labelled ancestor ('' to drop it)."""
    for r in _tsv(path):
        where = parse_ref(r.get("ref", ""))
        strong = base_strong("H", r.get("strongnumberx", ""))
        if where is None or not strong:
            continue
        domains: list[str] = []
        for code in r.get("lexdomain", "").split():
            code = labelled(code.split(">", 1)[0])
            if code and f"SDBH:{code}" not in domains:
                domains.append(f"SDBH:{code}")
        yield Word(
            hub(*where),
            strong,
            lemma=nfc(r.get("lemma", "")),
            domains=tuple(domains),
            gloss=r.get("english", "").strip(),
            lxx=base_strong("G", r.get("greekstrong", "")),
        )


def parse_sdbg_glosses(path: Path) -> dict[tuple[str, str], str]:
    """sdbg-domains-glosses.xml → {(lemma, LN entry): Louw–Nida gloss} (most frequent gloss per pair)."""
    seen: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for _, el in etree.iterparse(str(path), tag="morph", resolve_entities=False, huge_tree=True):
        for part in (el.get("SDBG") or "").split("|"):
            bits = part.split(";")
            if len(bits) == 3 and bits[1].strip() and bits[2].strip():
                seen[(nfc(bits[0]), bits[1].strip())][bits[2].strip()] += 1
        el.clear()
    return {k: c.most_common(1)[0][0] for k, c in seen.items()}


def load_labels(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise IngestError(f"{path.name}: expected a JSON object of domain labels")
    return {str(k): str(v).strip() for k, v in data.items() if str(k).isdigit() and str(v).strip()}


def nearest_labelled(labels: dict[str, str]) -> Callable[[str], str]:
    """SDBH codes are 3-digit segments ('001005002001'); unlabelled codes fall back to their parent."""

    def find(code: str) -> str:
        while code and code not in labels:
            code = code[:-3]
        return code

    return find


def sdbh_path(code: str, labels: dict[str, str]) -> list[str]:
    return [labels[code[:i]] for i in range(3, len(code) + 1, 3) if code[:i] in labels]


# ----------------------------------------------------------------------------- alignment


class Tok(NamedTuple):
    id: int
    vkey: int
    strong: str  # base Strong's of the token's lemma ('H1697' for H1697G)
    lemma_id: str
    preferred: bool  # Greek: the word is in the SBLGNT (MACULA's base text)


def align(words: Sequence[Word], tokens: Sequence[Tok]) -> list[Tok | None]:
    """Match each word to a token with the same base Strong's number, keeping order: first within the
    verse, then (for words the verses disagree on) within the chapter. Returns one token or None per word."""
    out: list[Tok | None] = [None] * len(words)
    used: set[int] = set()

    def run(key: Callable[[int], tuple[int, str]], tkey: Callable[[Tok], tuple[int, str]]) -> None:
        want: dict[tuple[int, str], list[int]] = defaultdict(list)
        for i in range(len(words)):
            if out[i] is None:
                want[key(i)].append(i)
        have: dict[tuple[int, str], list[Tok]] = defaultdict(list)
        for t in tokens:
            if t.id not in used and tkey(t) in want:
                have[tkey(t)].append(t)
        for k, idxs in want.items():
            cands = have.get(k, [])
            preferred = [t for t in cands if t.preferred]
            if len(preferred) >= len(idxs):
                cands = preferred
            for i, t in zip(idxs, cands, strict=False):
                out[i] = t
                used.add(t.id)

    run(lambda i: (words[i].vkey, words[i].strong), lambda t: (t.vkey, t.strong))
    run(lambda i: (words[i].vkey // 1000, words[i].strong), lambda t: (t.vkey // 1000, t.strong))
    return out


def _tokens(ctx: Context, edition: str, preferred: Callable[[Any], bool]) -> list[Tok]:
    rows = ctx.con.execute(
        "SELECT id, vkey, lemma_id, editions, word_type FROM token WHERE edition_id = ? AND lemma_id IS NOT NULL "
        "ORDER BY vkey, pos",
        (edition,),
    ).fetchall()
    return [
        Tok(r[0], r[1], r[2][:5], r[2], preferred(r))
        for r in rows
        if not (r[4] or "").startswith("X")  # TAHOT 'X' = LXX-retroverted words, not in the Hebrew text
    ]


def _primary_lemmas(ctx: Context, edition: str) -> dict[str, str]:
    """Base Strong's → the lemma id most used for it in an edition ('H1697' → 'H1697G')."""
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for lemma_id, n in ctx.con.execute(
        "SELECT lemma_id, count(*) FROM token WHERE edition_id = ? AND lemma_id IS NOT NULL GROUP BY lemma_id",
        (edition,),
    ):
        counts[lemma_id[:5]][lemma_id] += n
    out = {base: c.most_common(1)[0][0] for base, c in counts.items()}
    # lemmas never used in the edition (e.g. Greek words found only in the LXX): 'G1234' before 'G1234G'
    for (lemma_id,) in ctx.con.execute("SELECT id FROM lemma ORDER BY id"):
        out.setdefault(lemma_id[:5], lemma_id)
    return out


def _lemma_index(ctx: Context, tokens: Sequence[Tok]) -> dict[str, str]:
    """Dictionary form (exact, then accent-stripped) → base Strong's, for the lemmas the tokens use."""
    used = Counter(t.lemma_id for t in tokens)
    exact: dict[str, Counter[str]] = defaultdict(Counter)
    loose: dict[str, Counter[str]] = defaultdict(Counter)
    for lemma_id, lemma in ctx.con.execute("SELECT id, lemma FROM lemma"):
        if lemma_id in used and lemma:
            exact[nfc(lemma)][lemma_id[:5]] += used[lemma_id]
            loose[normalize(lemma)][lemma_id[:5]] += used[lemma_id]
    out = {f"~{k}": c.most_common(1)[0][0] for k, c in loose.items()}
    out.update({k: c.most_common(1)[0][0] for k, c in exact.items()})
    return out


def rekey(
    words: Sequence[Word], tokens: Sequence[Tok], by_lemma: dict[str, str], aliases: dict[str, str] | None = None
) -> list[Word]:
    """MACULA sometimes numbers an inflected form (G2076 ἐστί, G5213 ὑμῖν) where STEPBible numbers the
    lemma (G1510 εἰμί, G4771 σύ). Words whose Strong's number no token uses are re-keyed by their
    dictionary form; the rest are left alone. ``aliases`` receives old → new number (most common)."""
    known = {t.strong for t in tokens}
    seen: dict[str, Counter[str]] = defaultdict(Counter)
    out = []
    for w in words:
        if w.strong not in known:
            alt = by_lemma.get(w.lemma) or by_lemma.get(f"~{normalize(w.lemma)}")
            if alt:
                seen[w.strong][alt] += 1
                w = replace(w, strong=alt)
        out.append(w)
    if aliases is not None:
        aliases.update({old: c.most_common(1)[0][0] for old, c in seen.items()})
    return out


@dataclass
class Matched:
    """Words attached to lemmas: per lemma, the domains and glosses seen, and token updates."""

    lemma_domains: dict[str, Counter[str]]
    lemma_glosses: dict[tuple[str, str], Counter[str]]
    lemma_forms: dict[str, Counter[str]]  # MACULA's lemma (dictionary form) per lemma id
    token_updates: list[tuple[str | None, str | None, int]]  # (domain_id, lxx_equiv, token id)
    lxx: dict[str, Counter[str]]
    words: int = 0
    tokens: int = 0
    aligned: int = 0
    strongs: int = 0
    strongs_matched: int = 0
    lemmas: int = 0


def attach(words: Sequence[Word], tokens: Sequence[Tok], greek_primary: dict[str, str] | None = None) -> Matched:
    """Align words to tokens and aggregate their data per lemma of the matched token. Words without a
    token (mostly Hebrew prefixes such as וְ and בְּ, which STEPBible keeps inside the word) are left out,
    so every count stays consistent with the word's occurrences."""
    hits = align(words, tokens)
    m = Matched(defaultdict(Counter), defaultdict(Counter), defaultdict(Counter), [], defaultdict(Counter))
    m.words, m.tokens = len(words), len(tokens)
    strongs: set[str] = set()
    matched_strongs: set[str] = set()
    for w, t in zip(words, hits, strict=True):
        strongs.add(w.strong)
        if t is None:
            continue
        m.aligned += 1
        matched_strongs.add(w.strong)
        lemma_id = t.lemma_id
        if w.lemma:
            m.lemma_forms[lemma_id][w.lemma] += 1
        for d in w.domains:
            m.lemma_domains[lemma_id][d] += 1
            if w.gloss:
                m.lemma_glosses[(lemma_id, d)][w.gloss.lower()] += 1
        lxx = ""
        if w.lxx and greek_primary is not None:
            lxx = greek_primary.get(w.lxx, w.lxx)
            m.lxx[lemma_id][lxx] += 1
        if w.domains or lxx:
            m.token_updates.append((" ".join(w.domains) or None, lxx or None, t.id))
    m.strongs, m.strongs_matched = len(strongs), len(matched_strongs)
    m.lemmas = len(set(m.lemma_domains) | set(m.lxx))
    return m


def _write(ctx: Context, source: str, m: Matched, sense_gloss: Callable[[str, str], str], column: str) -> int:
    """lemma_sense rows (one per lemma and domain, most frequent first), token and lemma updates."""
    rows = []
    for lemma_id, domains in m.lemma_domains.items():
        for n, (d, _) in enumerate(domains.most_common(), 1):
            rows.append((lemma_id, n, d, sense_gloss(lemma_id, d) or None, source))
    ctx.clear(source, "lemma_sense")
    ctx.insert("lemma_sense", ["lemma_id", "n", "domain_id", "gloss", "source_id"], rows)
    for batch in batched(m.token_updates):
        ctx.con.executemany("UPDATE token SET domain_id = ?, lxx_equiv = coalesce(?, lxx_equiv) WHERE id = ?", batch)
    ctx.con.executemany(
        f"UPDATE lemma SET {column} = ? WHERE id = ?",
        (
            (" ".join(d.split(":", 1)[1] for d, _ in domains.most_common(8)), lemma_id)
            for lemma_id, domains in m.lemma_domains.items()
        ),
    )
    return len(rows)


def _log(ctx: Context, label: str, m: Matched, senses: int) -> None:
    ctx.log.info(
        "  %s: %d of %d MACULA Strong's numbers matched; %d of %d MACULA words aligned to %d STEPBible tokens "
        "(%.1f%% of the tokens); data for %d lemmas, %d senses",
        label,
        m.strongs_matched,
        m.strongs,
        m.aligned,
        m.words,
        m.tokens,
        100 * m.aligned / max(1, m.tokens),
        m.lemmas,
        senses,
    )


# ----------------------------------------------------------------------------- steps


@step("macula-greek", sources=[GREEK], requires=["stepbible-tagnt"])
def ingest_greek(ctx: Context) -> None:
    """MACULA Greek: Louw–Nida / SDBG semantic domains and senses of the NT words."""
    labels = load_labels(ctx.find(GREEK, "marble-domain-label-mapping.json"))
    glosses = parse_sdbg_glosses(ctx.find(GREEK, "sdbg-domains-glosses.xml"))
    parents: dict[str, Counter[str]] = {}
    words = list(parse_greek(ctx.find(GREEK, "macula-greek-SBLGNT.tsv"), parents))
    if not words:
        raise IngestError("macula-greek: no words parsed")

    entry_gloss: dict[str, Counter[str]] = defaultdict(Counter)
    for (_, ln), g in glosses.items():
        entry_gloss[ln][g] += 1
    ctx.clear(GREEK, "semantic_domain")
    rows: list[tuple[Any, ...]] = []
    for code, label in sorted(labels.items()):
        if len(code) == 3:
            rows.append((f"LN:{int(code)}", None, "louw-nida", label, f"Louw–Nida domain {int(code)}", GREEK))
        elif len(code) == 6 and code[:3] in labels:
            top = labels[code[:3]]
            rows.append((f"SDBG:{code}", f"LN:{int(code[:3])}", "sdbg", label, f"{top} › {label}", GREEK))
    for ln, seen in sorted(parents.items()):
        parent = seen.most_common(1)[0][0]
        label = entry_gloss[ln].most_common(1)[0][0] if entry_gloss.get(ln) else f"Louw–Nida {ln}"
        rows.append((ln_id(ln), parent, "louw-nida", label, f"Louw–Nida {ln}", GREEK))
    ctx.insert("semantic_domain", ["id", "parent_id", "system", "label", "description", "source_id"], rows)

    tokens = _tokens(ctx, "tagnt", lambda r: "SBL" in (r[3] or ""))
    aliases: dict[str, str] = {}
    m = attach(rekey(words, tokens, _lemma_index(ctx, tokens), aliases), tokens)
    ctx.cache[GREEK_ALIASES] = aliases  # the Hebrew step numbers LXX words the same way

    def gloss(lemma_id: str, domain: str) -> str:
        ln = domain.split(":", 1)[1]
        for form, _ in m.lemma_forms.get(lemma_id, Counter()).most_common():
            if (form, ln) in glosses:
                return glosses[(form, ln)]
        common = entry_gloss.get(ln)
        return common.most_common(1)[0][0] if common else ""

    senses = _write(ctx, GREEK, m, gloss, "ln")
    ctx.log.info("  %d semantic domains (%d Louw–Nida entries)", len(rows), len(parents))
    _log(ctx, "Greek", m, senses)


@step("macula-hebrew", sources=[HEBREW], requires=["stepbible-tahot", "macula-greek"])
def ingest_hebrew(ctx: Context) -> None:
    """MACULA Hebrew: SDBH semantic domains and the Septuagint's Greek equivalent of each Hebrew word."""
    labels = load_labels(ctx.find(HEBREW, "domain-label-mapping-1.json"))
    native = {
        ref: k
        for k, ref in ctx.con.execute(
            "SELECT vkey, native_ref FROM edition_verse WHERE edition_id = 'wlc' AND native_ref IS NOT NULL"
        )
    }

    def hub(book: str, ch: int, v: int) -> int:
        return native.get(f"{book}.{ch}.{v}") or vkey(book, ch, v)

    words = list(parse_hebrew(ctx.find(HEBREW, "macula-hebrew.tsv"), hub, nearest_labelled(labels)))
    if not words:
        raise IngestError("macula-hebrew: no words parsed")

    used_codes = {d.split(":", 1)[1] for w in words for d in w.domains}
    codes = {c[:i] for c in used_codes for i in range(3, len(c) + 1, 3)} | set(labels)
    ctx.clear(HEBREW, "semantic_domain")
    rows = [
        (
            f"SDBH:{c}",
            f"SDBH:{c[:-3]}" if len(c) > 3 else None,
            "sdbh",
            labels.get(c, c),
            " › ".join(sdbh_path(c, labels)),
            HEBREW,
        )
        for c in sorted(codes)
    ]
    ctx.insert("semantic_domain", ["id", "parent_id", "system", "label", "description", "source_id"], rows)

    greek_primary = _primary_lemmas(ctx, "tagnt")
    for old, new in ctx.cache.get(GREEK_ALIASES, {}).items():  # LXX G2071 ἔσομαι → εἰμί (G1510)
        greek_primary[old] = greek_primary.get(new, new)
    tokens = _tokens(ctx, "tahot", lambda r: True)
    m = attach(rekey(words, tokens, _lemma_index(ctx, tokens)), tokens, greek_primary)

    def gloss(lemma_id: str, domain: str) -> str:
        top = [g for g, _ in m.lemma_glosses.get((lemma_id, domain), Counter()).most_common(3)]
        return ", ".join(top)

    senses = _write(ctx, HEBREW, m, gloss, "sdbh")
    ctx.clear(HEBREW, "entity_link")
    links = [
        (f"lemma:{h}", LXX_REL, f"lemma:{g}", float(n), HEBREW) for h, greek in m.lxx.items() for g, n in greek.items()
    ]
    ctx.insert("entity_link", ["src", "rel", "dst", "weight", "source_id"], links)
    ctx.log.info("  %d SDBH domains; %d Hebrew → Greek (LXX) lemma links", len(rows), len(links))
    _log(ctx, "Hebrew", m, senses)
