"""Convert BTB/Obsidian-flavoured markdown into HTML for the web UI.

Wikilinks become <a class="wl" data-t="TARGET">label</a>; the front-end decides what a target is
(verse id, chapter, Strong's number, topic, pericope, morph code...).
"""

from __future__ import annotations

import html
import re

import markdown as _md

_WIKI = re.compile(r"(!?)\[\[([^\]|\\]+?)(?:\\?\|([^\]]*))?\]\]")
_CALLOUT = re.compile(r"^> \[!(\w+)\]([-+]?) ?(.*)$")
_MD = _md.Markdown(extensions=["tables", "footnotes", "sane_lists"], output_format="html")


def strip_frontmatter(text: str) -> str:
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            return text[end + 5 :]
    return text


def _wikilink(m: re.Match[str]) -> str:
    embed, target, label = m.group(1), m.group(2).strip(), m.group(3)
    t = html.escape(target, quote=True)
    if embed:
        return f'<div class="embed" data-embed="{t}"></div>'
    lab = label if label is not None else target
    return f'<a class="wl" data-t="{t}">{lab}</a>'


def wikilinks(text: str) -> str:
    return _WIKI.sub(_wikilink, text)


def _callouts(text: str) -> str:
    """Turn Obsidian callouts into <details> blocks."""
    out, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        m = _CALLOUT.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        kind, fold, title = m.groups()
        body = []
        i += 1
        while i < len(lines) and lines[i].startswith(">"):
            body.append(lines[i][1:].lstrip(" "))
            i += 1
        inner = render("\n".join(body))
        openattr = "" if fold == "-" else " open"
        out.append(f'<details class="callout callout-{kind}"{openattr}><summary>{title}</summary>{inner}</details>')
        out.append("")
    return "\n".join(out)


def _latex_spaces(text: str) -> str:
    return text.replace("$\\qquad$", "&emsp;&emsp;").replace("$\\quad$", "&emsp;").replace("\\_", "_")


def render(text: str, keep_footnotes: bool = True) -> str:
    text = strip_frontmatter(text)
    text = _latex_spaces(text)
    text = re.sub(r"==([^=\n]+)==", r"<mark>\1</mark>", text)
    text = _callouts(text)
    text = wikilinks(text)
    _MD.reset()
    return _MD.convert(text)


def inline(text: str) -> str:
    """Render a fragment without wrapping <p>."""
    h = render(text)
    if h.startswith("<p>") and h.endswith("</p>") and h.count("<p>") == 1:
        h = h[3:-4]
    return h


_TAGS = re.compile(r"<[^>]+>")


def plain(text: str) -> str:
    """Strip markdown/HTML/wikilinks to plain text (for search indexes)."""
    text = strip_frontmatter(text)
    text = _WIKI.sub(lambda m: m.group(3) if m.group(3) is not None else m.group(2), text)
    text = _TAGS.sub(" ", text)
    text = re.sub(r"\[\^\d+\]", "", text)
    text = re.sub(r"[*_=#>|`]", " ", text)
    text = text.replace("$\\quad$", " ").replace("$\\qquad$", " ")
    return html.unescape(re.sub(r"\s+", " ", text)).strip()
