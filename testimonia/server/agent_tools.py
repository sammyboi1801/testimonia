"""Study tools for the AI assistant: the same data the app shows, as compact, citable text.

Each tool is a JSON schema (provider-neutral) plus a Python function over the read-only store. They are
exposed three ways: to the server-side assistant loop, and over HTTP (``GET /api/agent/tools``,
``POST /api/agent/tool``) so a loop running in the browser — e.g. against a local Ollama model — can use them.
Results are plain text with app links, so any model can quote and cite them.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException

from ..refs import parse_refs
from . import api
from .store import Store

MAX_RESULT = 9000  # characters per tool result

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


FUNCTIONS: dict[str, Callable[..., str]] = {
    "search_texts": search_texts,
    "read_passage": read_passage,
    "study_verse": study_verse,
    "word_study": word_study,
    "read_work": read_work,
    "lookup_history": lookup_history,
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
    return (text if len(text) <= MAX_RESULT else text[:MAX_RESULT] + "\n…(truncated)"), False
