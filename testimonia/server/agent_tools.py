"""Study tools for the AI assistant: the same data the app shows, as compact, citable text.

Each tool is a JSON schema (provider-neutral) plus a Python function over the read-only store. They are
exposed three ways: to the server-side assistant loop, and over HTTP (``GET /api/agent/tools``,
``POST /api/agent/tool``) so a loop running in the browser — e.g. against a local Ollama model — can use them.
Results are plain text with app links, so any model can quote and cite them.
"""

from __future__ import annotations

import html
import json
import re
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

import httpx
from fastapi import HTTPException

from ..morphology import FEATURES
from ..refs import parse_refs
from . import api, reading, study
from .store import Store

MAX_RESULT = 9000  # characters per tool result
WIKIPEDIA = "https://en.wikipedia.org"
#: a generic client name (Wikipedia asks API clients to identify themselves; no personal details)
WIKI_HEADERS = {"User-Agent": "Testimonia/0.1 (https://github.com/sammyboi1801/testimonia)"}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_texts",
        "description": (
            "Full-text search across Bible translations, early Christian / Jewish / Roman writings, and Greek & "
            "Hebrew lexicons. Greek and Hebrew queries match without accents. Use it to find where a word, phrase, "
            "name or idea occurs. Returns references with snippets and the ids needed by read_work."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Words or phrase, e.g. 'only begotten', 'λόγος', 'Melchizedek'",
                },
                "scope": {
                    "type": "string",
                    "enum": ["all", "bible", "writings", "lexicon"],
                    "description": "Where to search",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "read_passage",
        "description": (
            "Read a Bible passage (up to 40 verses) in one or more translations, with the translators' footnotes. "
            "Translations: bsb (default), kjva, web, asv, ylt, darby, webster, lsv, geneva, tyndale, dra, brenton "
            "(Septuagint in English), vulgate (Latin)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reference": {"type": "string", "description": "e.g. 'John 1:1-18', 'Isa 53', 'Ps 22:1'"},
                "translations": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Edition ids; default ['bsb']",
                },
            },
            "required": ["reference"],
            "additionalProperties": False,
        },
    },
    {
        "name": "study_verse",
        "description": (
            "Everything behind one verse: where the Greek/Hebrew editions and manuscripts differ, translators' notes, "
            "the church fathers who quote it (with dates; pre-Nicene first), Old/New Testament quotations, cross "
            "references, and Jewish & Roman parallels (Josephus, Tacitus…)."
        ),
        "parameters": {
            "type": "object",
            "properties": {"reference": {"type": "string", "description": "One verse, e.g. 'John 1:18'"}},
            "required": ["reference"],
            "additionalProperties": False,
        },
    },
    {
        "name": "word_study",
        "description": (
            "A Greek or Hebrew word: dictionary form, meaning, how often and how it is translated, and lexicon "
            "entries. Give an extended Strong's number (G3056, H0430) or the word itself (λόγος, אלהים)."
        ),
        "parameters": {
            "type": "object",
            "properties": {"word": {"type": "string"}},
            "required": ["word"],
            "additionalProperties": False,
        },
    },
    {
        "name": "read_work",
        "description": (
            "Read a section of an early Christian, Jewish or Roman work (church fathers, Josephus, Tacitus…). Use the "
            "edition id and section number from search_texts or study_verse results."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "edition": {"type": "string", "description": "Edition id, e.g. 'irenaeus.against-heresies@anf01'"},
                "section": {"type": "integer", "description": "Section number (ord)"},
            },
            "required": ["edition", "section"],
            "additionalProperties": False,
        },
    },
    {
        "name": "lookup_history",
        "description": (
            "Who/when: a writer (life dates, era, works in the library) or a historical event (date, description), "
            "e.g. 'Irenaeus', 'Josephus', 'Council of Nicaea', 'destruction of the Temple'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "book_overview",
        "description": (
            "A book of the Bible as a whole: size, setting, outline by section, its most-quoted verses and who quoted it "
            "most, notable textual variants, and its Old/New Testament links. Input: the book's name, e.g. 'Romans'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"book": {"type": "string"}},
            "required": ["book"],
            "additionalProperties": False,
        },
    },
    {
        "name": "timeline",
        "description": (
            "What happened and who was writing in a span of years: events and the early Christian, Jewish and Roman "
            "writers active then, with their works. Years as numbers; negative for BC, e.g. 90 to 150."
        ),
        "parameters": {
            "type": "object",
            "properties": {"from_year": {"type": "integer"}, "to_year": {"type": "integer"}},
            "required": ["from_year", "to_year"],
            "additionalProperties": False,
        },
    },
    {
        "name": "compare_translations",
        "description": "One to three verses in all thirteen translations side by side, to compare wording.",
        "parameters": {
            "type": "object",
            "properties": {"reference": {"type": "string"}},
            "required": ["reference"],
            "additionalProperties": False,
        },
    },
    {
        "name": "fathers_on",
        "description": (
            "Every early Christian, Jewish or Roman writer in the library who quotes a verse, oldest first, with the "
            "words they wrote and a link to read more (read_work). Optionally only writers before a year, e.g. 325 "
            "for before Nicaea."
        ),
        "parameters": {
            "type": "object",
            "properties": {"reference": {"type": "string"}, "before_year": {"type": "integer"}},
            "required": ["reference"],
            "additionalProperties": False,
        },
    },
    {
        "name": "passage_guide",
        "description": (
            "A whole passage (e.g. 'John 1:1-18', 'Isaiah 53', or one verse for its section): its text, where the "
            "editions differ verse by verse, which early writers quote it (grouped, pre-Nicene first), the strongest "
            "cross references, Old/New Testament quotations, translators' notes, topics and setting."
        ),
        "parameters": {
            "type": "object",
            "properties": {"reference": {"type": "string"}},
            "required": ["reference"],
            "additionalProperties": False,
        },
    },
    {
        "name": "grammar_search",
        "description": (
            "Find Greek NT or Hebrew OT words by dictionary form and grammar, e.g. every aorist passive of λύω, or "
            "θεός without the article in John. Give the word (Greek/Hebrew, transliteration, or Strong's like G2316) "
            "and any filters. Greek: part, tense, voice, mood, case, person, number, gender. Hebrew: part, stem, form, "
            "person, gender, number, state. Returns verses with the parsed word, counts by book, paged by 25."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "word": {"type": "string"},
                "book": {"type": "string", "description": "optional book, e.g. 'John' or 'Gen'"},
                "without_article": {"type": "integer", "description": "1 = only where no article precedes"},
                "page": {"type": "integer"},
                "part": {"type": "string"},
                "tense": {"type": "string"},
                "voice": {"type": "string"},
                "mood": {"type": "string"},
                "case": {"type": "string"},
                "person": {"type": "string"},
                "number": {"type": "string"},
                "gender": {"type": "string"},
                "stem": {"type": "string"},
                "form": {"type": "string"},
                "state": {"type": "string"},
            },
            "required": ["word"],
            "additionalProperties": False,
        },
    },
    {
        "name": "topic",
        "description": (
            "The topical concordance (5,300 topics): the verses on a subject, grouped by book, related topics, the "
            "early writers who quote those verses most, and the strongest links between them. Input: a subject, e.g. "
            "'faith', 'resurrection', 'baptism'. Optionally limit to one book."
        ),
        "parameters": {
            "type": "object",
            "properties": {"subject": {"type": "string"}, "book": {"type": "string"}},
            "required": ["subject"],
            "additionalProperties": False,
        },
    },
    {
        "name": "gospel_parallels",
        "description": (
            "The Gospel synopsis: for a Gospel verse or a section title, the parallel accounts in Matthew, Mark, Luke "
            "and John side by side, to compare what each Gospel includes. Input: e.g. 'Mark 1:9' or 'baptism of Jesus'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "wikipedia",
        "description": (
            "Background from English Wikipedia, a secondary source outside the library: people, places, manuscripts, "
            "councils and modern scholarship the library does not cover. Check the library first; cite the article "
            "link the tool returns and say it is Wikipedia. Input: a short search phrase, e.g. 'Sosthenes'. The first call returns the whole introduction and the list of sections; call again with `section` to read any of them in full."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "section": {
                    "type": "string",
                    "description": "optional: a section title from the first call, to read that section in full",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
]

_TAGS = re.compile(r"<[^>]+>")


def _plain(s: str | None) -> str:
    return " ".join(html.unescape(_TAGS.sub(" ", s or "")).split())


def _req(store: Store) -> Any:
    """A stand-in for the FastAPI request: the API functions only read ``request.app.state.store``."""
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(store=store)))


def _verse_link(osis: str) -> str:
    book, ch, _v = osis.split(".")
    return f"/read/{book}/{ch}?v={osis}"


def _label(osis: str) -> str:
    book, ch, v = osis.split(".")
    return f"{book} {ch}:{v}"


def search_texts(store: Store, query: str, scope: str = "all") -> str:
    scope_api = {"writings": "works"}.get(scope, scope)
    r = api.search(_req(store), q=query[:200], scope=scope_api, edition=None, limit=12)
    out: list[str] = []
    if r.get("reference"):
        out.append(f"(The query is also a Bible reference: {r['reference']['label']})")
    for b in r.get("bible", []):
        out.append(f"- [{_label(b['osis'])}]({_verse_link(b['osis'])}) ({b.get('abbrev')}): {_plain(b['snippet'])}")
    for w in r.get("works", []):
        out.append(
            f"- {w.get('author') or 'Anonymous'}, {w['work_title']} {w.get('cite') or ''} "
            f"[edition={w['edition_id']} section={w['ord']}](/library/{w['edition_id']}/{w['ord']}): {_plain(w['snippet'])}"
        )
    for lx in r.get("lexicon", []):
        out.append(f"- word {lx['id']} {lx['lemma']} ({lx.get('translit') or ''}): {lx.get('gloss') or ''}")
    return "\n".join(out) or "No results."


def read_passage(store: Store, reference: str, translations: list[str] | None = None) -> str:
    refs = parse_refs(reference)
    if not refs:
        return f"Could not read {reference!r} as a Bible reference."
    eds = [t for t in (translations or ["bsb"]) if re.fullmatch(r"[a-z0-9]{2,12}", t)][:4] or ["bsb"]
    r = refs[0]
    marks = ",".join("?" * len(eds))
    rows = store.all(
        f"SELECT v.osis, ev.edition_id, ev.text, ev.vkey FROM edition_verse ev JOIN verse v ON v.vkey = ev.vkey "
        f"WHERE ev.vkey BETWEEN ? AND ? AND ev.edition_id IN ({marks}) ORDER BY ev.vkey, ev.edition_id LIMIT ?",
        (r.start, r.end, *eds, 40 * len(eds)),
    )
    if not rows:
        return f"No text found for {reference} in {', '.join(eds)}."
    notes = store.all(
        f"SELECT edition_id, vkey, kind, body FROM edition_note WHERE vkey BETWEEN ? AND ? AND edition_id IN ({marks}) "
        f"ORDER BY vkey, n",
        (r.start, rows[-1]["vkey"], *eds),
    )
    by_verse: dict[int, list[str]] = {}
    for n in notes:
        by_verse.setdefault(n["vkey"], []).append(f"[{n['edition_id']} note, {n['kind']}: {_plain(n['body'])}]")
    out = []
    for row in rows:
        out.append(f"{_label(row['osis'])} ({row['edition_id']}) {row['text']}")
        if row["edition_id"] == eds[-1]:
            out.extend(by_verse.get(row["vkey"], []))
    return "\n".join(out)


def study_verse(store: Store, reference: str) -> str:
    refs = parse_refs(reference)
    if not refs:
        return f"Could not read {reference!r} as a Bible reference."
    osis = api._osis(refs[0].start)
    try:
        g = api.verse(_req(store), osis=osis, preview="bsb", limit=40)
    except HTTPException:
        return f"No verse {reference}."
    out = [f"# {_label(osis)} — link: {_verse_link(osis)}"]
    for t in g["texts"][:4]:
        out.append(f"{t.get('abbrev') or t['edition_id']}: {t['text']}")
    if g["variants"]:
        out.append("\n## Where the editions differ")
        for v in g["variants"]:
            readings = "; ".join(
                f"{r['text'] or '— omitted —'} ({r.get('gloss') or ''}) in "
                + ", ".join(w if isinstance(w, str) else str(w.get("witness_id", "")) for w in r.get("witnesses") or [])
                for r in v["readings"]
            )
            out.append(f"- [{v['significance']}] {readings}" + (f" — {v['note']}" if v.get("note") else ""))
    if g.get("footnotes"):
        out.append("\n## Translators' notes")
        out.extend(f"- {f.get('abbrev') or f['edition_id']} ({f['kind']}): {_plain(f['body'])}" for f in g["footnotes"])
    if g["fathers"]:
        out.append("\n## Quoted by the church fathers (earliest first)")
        for f in g["fathers"][:20]:
            out.append(
                f"- {f.get('author') or 'Anonymous'} (c. {f.get('year') or '?'}), {f['work_title']} {f.get('cite') or ''} "
                f"[edition={f['edition_id']} section={f['section_ord']}]: {(f.get('snippet') or '')[:220]}"
            )
    if g.get("witnesses"):
        out.append("\n## Jewish & Roman writers")
        out.extend(
            f"- {w['author']}, {w['work_title']} {w.get('cite') or ''}: {w.get('snippet') or ''}"
            for w in g["witnesses"]
        )
    if g["quotations"]:
        out.append("\n## Old ↔ New Testament")
        out.extend(
            f"- {q['direction']} [{_label(q['osis'])}]({_verse_link(q['osis'])}): {q.get('text') or ''}"
            for q in g["quotations"][:10]
        )
    if g["crossrefs"]:
        out.append("\n## Cross references")
        out.append(", ".join(f"[{_label(x['osis'])}]({_verse_link(x['osis'])})" for x in g["crossrefs"][:12]))
    return "\n".join(out)


def word_study(store: Store, word: str) -> str:
    w = word.strip()
    strong = w.upper() if re.fullmatch(r"[GHgh]\d{1,4}[A-Za-z]?", w) else None
    if strong and len(strong) < 5:
        strong = strong[0] + strong[1:].zfill(4)
    if strong is None:
        hit = api.original_language_search(store, w, 1).get("lexicon") or []
        if not hit:
            return f"No Greek or Hebrew word found for {word!r}."
        strong = hit[0]["id"]
    try:
        d = api.word(_req(store), strong=strong, limit=60)
    except HTTPException as e:
        return str(e.detail)
    lem = d.get("lemma") or {}
    out = [f"# {lem.get('lemma', strong)} ({lem.get('translit') or ''}) {strong}: {lem.get('gloss') or ''}"]
    out.append(
        f"Used {d['total']} times. Translated as: " + ", ".join(f"{g['gloss']} ({g['n']})" for g in d["glosses"][:12])
    )
    out.append("Most in: " + ", ".join(f"{b['name']} {b['n']}" for b in d["by_book"][:8]))
    for lx in d["lexicons"][:2]:
        out.append(f"\n## {lx.get('title') or lx['lexicon_id']}\n{_plain(lx['body'])[:1800]}")
    out.append(
        "\nSome occurrences: "
        + ", ".join(f"[{_label(o['osis'])}]({_verse_link(o['osis'])})" for o in d["occurrences"][:12])
    )
    return "\n".join(out)


def read_work(store: Store, edition: str, section: int) -> str:
    try:
        toc = api.toc(_req(store), edition_id=edition)
        sec = api.section(_req(store), edition_id=edition, ord_=int(section))
    except HTTPException:
        return f"No section {section} in edition {edition!r}."
    e = toc["edition"]
    s = sec["section"]
    head = f"# {e.get('author') or 'Anonymous'}, {e['title']} — {s.get('title') or s.get('cite')} (link: /library/{edition}/{section})"
    cites = ", ".join(f"[{_label(c['osis'])}]({_verse_link(c['osis'])})" for c in sec["citations"][:20])
    body = s.get("text") or _plain(s.get("html"))
    return f"{head}\n{body[:7000]}" + (f"\n\nScripture cited here: {cites}" if cites else "")


def lookup_history(store: Store, name: str) -> str:
    q = name.lower().strip()
    t = api.timeline(_req(store))
    out = []
    for a in t["authors"]:
        if q in a["name"].lower() or a["name"].lower() in q:
            works = "; ".join(f"{w['title']} [edition={w['edition_id']} section=1]" for w in a["works"][:12])
            out.append(
                f"# {a['name']}: born {a['born']}, died {a['died']}, active {a['floruit_from']}–{a['floruit_to']} "
                f"(approximate: {', '.join(a['circa']) or 'no'}); era {a['era']}; {a.get('summary') or ''}\nWorks: {works}"
            )
    for e in t["events"]:
        if q in e["title"].lower():
            out.append(f"# {e['title']}: {e['start']}–{e['end']} ({e['kind']}). {e.get('description') or ''}")
    return "\n".join(out[:6]) or f"Nothing in the timeline matches {name!r}. Try search_texts."


def _wiki_client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(10.0), headers=WIKI_HEADERS, follow_redirects=True)


_HEADING = re.compile(r"^(={2,6})\s*(.+?)\s*\1\s*$", re.M)


def _wiki_sections(text: str) -> list[tuple[str, str]]:
    """[(name, body)]: the lead first (name ''), then each section with its subsections."""
    marks = list(_HEADING.finditer(text))
    parts = [("", (text[: marks[0].start()] if marks else text).strip())]
    for i, m in enumerate(marks):
        level = len(m.group(1))
        stop = next((n.start() for n in marks[i + 1 :] if len(n.group(1)) <= level), len(text))
        body = _HEADING.sub(lambda h: f"\n### {h.group(2)}", text[m.end() : stop]).strip()
        if body:  # reference lists and link sections come back empty in plain-text extracts
            parts.append((m.group(2), body))
    return parts


def passage_guide(store: Store, reference: str) -> str:
    """Everything about a passage, condensed for the assistant."""
    refs = parse_refs(reference)
    if refs:
        a, b = api._osis(refs[0].start), api._osis(refs[0].end)
        ref = a if a == b else f"{a}-{b}"
    else:
        ref = reference
    try:
        g = study.passage(_req(store), ref, edition="bsb", limit=200)
    except HTTPException as e:
        return f"Could not open {reference!r}: {e.detail}"
    r = g["range"]
    out = [f"# {r['label']} — guide: /passage/{r['ref']}"]
    out += [f"{v['osis'].split('.', 1)[1].replace('.', ':')} {v['text']}" for v in g["verses"][:60]]
    if g["variants"]:
        out.append("\n## Where the editions differ")
        for v in g["variants"][:30]:
            readings = "; ".join(f"{x.get('text') or '— omitted —'}" for x in v.get("readings", []))
            out.append(f"- {_label(v['osis']) if v.get('osis') else ''} [{v.get('significance')}] {readings}")
    for key, title in (("fathers", "Early Christian writers quoting it"), ("witnesses", "Jewish and Roman writers")):
        if g[key]:
            out.append(f"\n## {title}")
            for w in g[key][:25]:
                verses = ", ".join(_label(x) for x in (w.get("verses") or [])[:6])
                out.append(f"- {w['name']} (c. {w.get('year') or '?'}), ×{w['n']}: {verses}")
    if g["crossrefs"]:
        out.append("\n## Strongest cross references")
        out += [f"- {_label(c['osis'])} ({c.get('votes')} votes): {c.get('text') or ''}" for c in g["crossrefs"][:15]]
    if g["quotations"]:
        out.append("\n## Old/New Testament links")
        out += [f"- {json.dumps(q, ensure_ascii=False)}" for q in g["quotations"][:10]]
    if g["topics"]:
        out.append("\nTopics: " + ", ".join(f"{t['name']} ({t['n']})" for t in g["topics"][:15]))
    if g["footnotes"]:
        out.append("\n## Translators' notes")
        out += [f"- {n['osis']} {n.get('abbrev')}: {_plain(n['body'])}" for n in g["footnotes"][:20]]
    when = g.get("chronology") or {}
    if when.get("labels"):
        out.append(
            "\nSetting: " + ", ".join(when["labels"]) + "; " + ", ".join(p["name"] for p in g.get("periods") or [])
        )
    return "\n".join(out)


def grammar_search(
    store: Store, word: str, book: str | None = None, without_article: int = 0, page: int = 1, **features: str
) -> str:
    """Greek/Hebrew forms by grammar, via the same search the app's Grammar tab uses."""
    for name, value in features.items():
        allowed = sorted({v for lang in FEATURES.values() for v in lang.get(name, [])})
        if value not in allowed:
            return f"Unknown {name} {value!r}; use one of: {', '.join(allowed)}."
    strong = word.upper() if re.fullmatch(r"[GHgh]\d{1,5}[A-Za-z]?", word.strip()) else None
    book_osis = _book_osis(book) if book else None
    if book and not book_osis:
        return f"Unknown book {book!r}."
    args: dict[str, Any] = {
        name: features.get(name)
        for name in ("part", "tense", "voice", "mood", "case", "person", "number", "gender", "stem", "form", "state")
    }
    try:
        g = study.grammar(
            _req(store),
            lemma=None if strong else word,
            strong=strong,
            lang=None,
            book=book_osis,
            article="without" if without_article else None,
            no_article=False,
            edition="bsb",
            page=max(1, page),
            size=25,
            **args,
        )
    except HTTPException as e:
        return f"Grammar search failed: {e.detail}"
    lemmas = ", ".join(f"{x['lemma']} ({x['id']}, {x.get('gloss') or ''})" for x in g["lemmas"])
    out = [f"# {g['total']} matches in {g['verses']} verses for {lemmas or word} — page {g['page']}"]
    out.append("By book: " + ", ".join(f"{b['name']} {b['n']}" for b in g["by_book"]))
    for r in g["results"]:
        hits = "; ".join(f"{w['surface']} = {w.get('parse')}" for w in r["words"] if w.get("hit"))
        out.append(f"- {_label(r['osis'])} ({_verse_link(r['osis'])}): {hits} — {r.get('text') or ''}")
    if g["page"] * g["size"] < g["verses"]:
        out.append(f"More: call again with page={g['page'] + 1}.")
    return "\n".join(out)


def topic(store: Store, subject: str, book: str | None = None) -> str:
    """A subject in the topical concordance."""
    found = reading.topics(_req(store), q=subject)["topics"]
    if not found:
        return f"No topic matches {subject!r}. Try a broader word, or search_texts."
    exact = next((t for t in found if t["name"].lower() == subject.strip().lower()), None)
    pick = exact or max(found, key=lambda t: t["verses"])
    book_osis = _book_osis(book) if book else None
    try:
        g = reading.topic(_req(store), pick["id"], edition="bsb", book=book_osis)
    except HTTPException as e:
        return f"Could not open topic {pick['name']!r}: {e.detail}"
    out = [f"# Topic: {g['topic']['name']} — {g['total']} verses — link: /topic/{pick['id']}"]
    out.append("By book: " + ", ".join(f"{b['name']} {b['verses']}" for b in g["books"]))
    out += [f"- {_label(v['osis'])}: {v['text']}" for v in g["verses"][:120]]
    if g.get("truncated"):
        out.append("(more verses: call again with book=… for one book)")
    if g["related"]:
        out.append("\nRelated topics: " + ", ".join(r["name"] for r in g["related"][:20]))
    if g["fathers"]:
        out.append(
            "\nEarly writers quoting these verses most: "
            + ", ".join(f"{f['name']} (c. {f['year']}, ×{f['n']})" for f in g["fathers"][:12])
        )
    others = [t["name"] for t in found if t["id"] != pick["id"]][:10]
    if others:
        out.append("Other matching topics: " + ", ".join(others))
    return "\n".join(out)


def gospel_parallels(store: Store, query: str) -> str:
    """Parallel Gospel accounts for a verse or a section title."""
    refs = parse_refs(query)
    if refs:
        sections = reading.parallels(_req(store), verse=api._osis(refs[0].start))["sections"]
    else:
        q = query.strip().lower()
        sections = [x for x in reading.parallels(_req(store), verse=None)["sections"] if q in x["title"].lower()]
    if not sections:
        return f"No Gospel parallels found for {query!r}."
    out = []
    for sec in sections[:3]:
        g = reading.parallel(_req(store), sec["id"], edition="bsb")
        out.append(f"# {g['title']} — synopsis: /parallels/{sec['id']}")
        for col in g["columns"]:
            for p in col["passages"]:
                text = " ".join(f"{v['verse']} {v['text']}" for v in p.get("verses", []))
                out.append(f"## {p['label']}\n{text}")
    if len(sections) > 3:
        out.append("Other sections: " + "; ".join(x["title"] for x in sections[3:12]))
    return "\n".join(out)


def wikipedia(store: Store, query: str, section: str | None = None) -> str:
    """English Wikipedia, fetched live (nothing stored): the article's whole introduction and its list of sections,
    or one section in full when `section` is given, so any part of the article can be read."""
    common: dict[str, str | int] = {"format": "json", "formatversion": 2}
    try:
        with _wiki_client() as http:
            found = http.get(
                f"{WIKIPEDIA}/w/api.php",
                params={**common, "action": "query", "list": "search", "srsearch": query, "srlimit": 5},
            )
            found.raise_for_status()
            hits = found.json().get("query", {}).get("search", [])
            if not hits:
                return f"No Wikipedia article matches {query!r}."
            title = str(hits[0]["title"])
            page = http.get(
                f"{WIKIPEDIA}/w/api.php",
                params={
                    **common,
                    "action": "query",
                    "prop": "extracts",
                    "explaintext": 1,
                    "exsectionformat": "wiki",
                    "redirects": 1,
                    "titles": title,
                },
            )
            page.raise_for_status()
            pages = page.json().get("query", {}).get("pages", [])
    except httpx.HTTPError as e:
        return f"Wikipedia could not be reached ({type(e).__name__}); answer from the library alone."
    parts = _wiki_sections(str((pages[0].get("extract") if pages else "") or ""))
    head = (
        f"# Wikipedia: {title}\n"
        f"Link: {WIKIPEDIA}/wiki/{title.replace(' ', '_')} (Wikipedia, CC BY-SA 4.0; a secondary source, not part of the library)\n"
    )
    names = [name for name, _ in parts[1:]]
    if section:
        want = section.strip().lower()
        hit = next((p for p in parts[1:] if p[0].lower() == want), None) or next(
            (p for p in parts[1:] if want in p[0].lower()), None
        )
        if hit is None:
            return head + f"\nNo section {section!r} in this article. Sections: {'; '.join(names) or 'none'}"
        return head + f"\n## {hit[0]}\n{hit[1]}"
    out = head + "\n" + (parts[0][1] or "(no introduction)")
    if names:
        out += "\n\nSections (read any of them in full with the `section` argument): " + "; ".join(names)
    others = ", ".join(str(h["title"]) for h in hits[1:])
    return out + (f"\nOther matching articles: {others}" if others else "")


TRANSLATIONS = [
    "kjva",
    "bsb",
    "web",
    "asv",
    "ylt",
    "darby",
    "webster",
    "lsv",
    "geneva",
    "tyndale",
    "dra",
    "brenton",
    "vulgate",
]


def _book_osis(book: str) -> str | None:
    refs = parse_refs(f"{book} 1") or parse_refs(book)
    return api._osis(refs[0].start).split(".")[0] if refs else None


def book_overview(store: Store, book: str) -> str:
    """One book: size, setting, outline, its most-quoted verses and who quoted it most, notable variants."""
    osis = _book_osis(book)
    if not osis:
        return f"Could not read {book!r} as a book of the Bible."
    try:
        g = api.book_guide(_req(store), osis=osis, preview="bsb")
    except HTTPException:
        return f"No book {book!r} in the library."
    b, st = g["book"], g["stats"]
    names = " · ".join(x for x in (b.get("hebrew_name"), b.get("greek_name"), b.get("latin_name")) if x)
    out = [
        f"# {b['name']} ({names}) — link: /book/{osis}",
        f"{b.get('testament')} · {b.get('genre') or ''} · {st['chapters']} chapters, {st['verses']} verses · "
        f"{st['variants']} variant units · quoted {st['citations']} times by early writers",
    ]
    when = g.get("chronology") or {}
    if when.get("start") is not None:
        out.append(f"Narrative/composition setting (approximate): {when['start']}–{when.get('end')}")
    if g["outline"]:
        out.append("\n## Outline")
        out += [f"- {o['title']} ({_label(o['osis'])})" for o in g["outline"][:60]]
    if g["quoted"]:
        out.append("\n## Most quoted by early writers")
        out += [
            f"- {_label(q['osis'])} ×{q['n']} ({q['pre_nicene']} before Nicaea): {q.get('text') or ''}"
            for q in g["quoted"][:12]
        ]
    if g["readers"]:
        out.append("\n## Who quoted it most")
        out.append(", ".join(f"{r['name']} (d. {r.get('year')}, ×{r['n']})" for r in g["readers"][:12]))
    if g["notable_variants"]:
        out.append("\n## Notable variants")
        out += [f"- {_label(v['osis'])}: {v['label']}" for v in g["notable_variants"][:12]]
    if g["quotations"]:
        out.append("\n## Old/New Testament links")
        out += [f"- {_label(q['here'])} {q['direction']} {_label(q['other'])}" for q in g["quotations"][:20]]
    return "\n".join(out)


def timeline(store: Store, from_year: int, to_year: int) -> str:
    """Events and writers in a span of years (negative years are BC)."""
    lo, hi = sorted((from_year, to_year))
    t = api.timeline(_req(store))
    out = [f"# {lo}–{hi} (negative = BC; dates approximate)"]
    events = [
        e for e in t["events"] if e.get("start") is not None and e["start"] <= hi and (e.get("end") or e["start"]) >= lo
    ]
    if events:
        out.append("\n## Events")
        out += [
            f"- {e['start']}–{e.get('end') or e['start']}: {e['title']}. {e.get('description') or ''}"
            for e in sorted(events, key=lambda e: e["start"])
        ]

    def active(a: dict[str, Any]) -> bool:
        a_lo = a.get("floruit_from") or a.get("born") or a.get("died")
        a_hi = a.get("died") or a.get("floruit_to") or a_lo
        return a_lo is not None and a_lo <= hi and (a_hi or a_lo) >= lo

    writers = sorted((a for a in t["authors"] if active(a)), key=lambda a: a.get("floruit_from") or a.get("born") or 0)
    if writers:
        out.append("\n## Writers active then")
        out += [
            f"- {a['name']} ({a.get('born') or '?'}–{a.get('died') or '?'}; {a.get('era') or ''}): "
            + "; ".join(w["title"] for w in a["works"][:5])
            for a in writers
        ]
    return "\n".join(out) if len(out) > 1 else f"Nothing in the timeline between {lo} and {hi}."


def compare_translations(store: Store, reference: str) -> str:
    """One to three verses in all thirteen translations, for comparing wording."""
    refs = parse_refs(reference)
    if refs and refs[0].end - refs[0].start > 2:
        return "Give at most three verses, e.g. 'John 1:1' or 'John 1:1-3'."
    return read_passage(store, reference, translations=TRANSLATIONS)


def fathers_on(store: Store, reference: str, before_year: int | None = None) -> str:
    """Every early writer quoting a verse, oldest first, with the words they wrote."""
    refs = parse_refs(reference)
    if not refs:
        return f"Could not read {reference!r} as a Bible reference."
    osis = api._osis(refs[0].start)
    try:
        g = api.verse(_req(store), osis=osis, preview="bsb", limit=500)
    except HTTPException:
        return f"No verse {reference}."
    rows = [
        f
        for f in (g.get("fathers") or []) + (g.get("witnesses") or [])
        if before_year is None or (f.get("year") or 9999) < before_year
    ]
    rows.sort(key=lambda f: f.get("year") or 9999)
    if not rows:
        return f"No early writer in the library quotes {_label(osis)}" + (
            f" before {before_year}." if before_year else "."
        )
    out = [f"# Quotations of {_label(osis)} — {len(rows)} — link: {_verse_link(osis)}"]
    for f in rows[:80]:
        where = (
            f"[edition={f['edition_id']} section={f['section_ord']}]"
            if f.get("edition_id") and f.get("section_ord")
            else ""
        )
        out.append(
            f"- {f.get('author') or 'Anonymous'} (c. {f.get('year') or '?'}), {f.get('work_title')} {f.get('cite') or ''} {where}: "
            + _plain(f.get("snippet"))[:400]
        )
    return "\n".join(out)


FUNCTIONS: dict[str, Callable[..., str]] = {
    "search_texts": search_texts,
    "read_passage": read_passage,
    "study_verse": study_verse,
    "word_study": word_study,
    "read_work": read_work,
    "lookup_history": lookup_history,
    "book_overview": book_overview,
    "timeline": timeline,
    "compare_translations": compare_translations,
    "fathers_on": fathers_on,
    "passage_guide": passage_guide,
    "grammar_search": grammar_search,
    "topic": topic,
    "gospel_parallels": gospel_parallels,
    "wikipedia": wikipedia,
}

#: characters per result; Wikipedia sections are passed on whole so nothing in an article is out of reach
LIMITS = {
    "topic": 30_000,
    "gospel_parallels": 30_000,
    "passage_guide": 30_000,
    "grammar_search": 20_000,
    "wikipedia": 60_000,
    "fathers_on": 30_000,
    "compare_translations": 20_000,
    "book_overview": 20_000,
}


def validate(name: str, args: Any) -> str | None:
    """Return an error message if the arguments don't fit the tool's schema (model output is untrusted)."""
    spec = next((t for t in TOOLS if t["name"] == name), None)
    if spec is None:
        return f"unknown tool {name!r}"
    if not isinstance(args, dict):
        return "arguments must be a JSON object"
    props = spec["parameters"]["properties"]
    for key in spec["parameters"]["required"]:
        if key not in args:
            return f"missing argument {key!r}"
    for key, value in args.items():
        if key not in props:
            return f"unexpected argument {key!r}"
        kind = props[key]["type"]
        ok = {
            "string": isinstance(value, str),
            "integer": isinstance(value, int) and not isinstance(value, bool),
            "array": isinstance(value, list) and all(isinstance(v, str) for v in value),
        }[kind]
        if not ok:
            return f"argument {key!r} must be a {kind}"
        if "enum" in props[key] and value not in props[key]["enum"]:
            return f"argument {key!r} must be one of {props[key]['enum']}"
    return None


def run(store: Store, name: str, args: Any) -> tuple[str, bool]:
    """Execute a tool → (text, is_error)."""
    error = validate(name, args)
    if error:
        return f"Error: {error}", True
    try:
        text = FUNCTIONS[name](store, **args)
    except Exception as e:  # a tool failure must not end the conversation
        return f"Error: {type(e).__name__}: {e}", True
    limit = LIMITS.get(name, MAX_RESULT)
    return (text if len(text) <= limit else text[:limit] + "\n…(truncated)"), False
