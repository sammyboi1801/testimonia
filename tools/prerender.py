"""Pre-built HTML for every chapter, a sitemap and robots.txt, so search engines see real text.

    py tools/prerender.py DIST STATIC [--site https://testimonia.web.app]

DIST is the built web app (its index.html is the template); STATIC is the `testimonia export-static` folder.
Each chapter becomes DIST/read/{book}/{ch}/index.html: the app's page with the chapter's own title, description
and text inside #root. The app starts as usual and replaces that text with the reader.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

PROSE = ["web", "kjva", "brenton", "dra"]  # the first that has the chapter is the text written into the page


def _attr(page: str, start: str, value: str) -> str:
    """Replace the value of the attribute that ``start`` opens (up to its closing quote)."""
    i = page.find(start)
    if i < 0:
        return page
    j = page.index('"', i + len(start))
    return page[: i + len(start)] + value + page[j:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist", type=Path)
    ap.add_argument("static", type=Path)
    ap.add_argument("--site", default="https://testimonia.web.app")
    a = ap.parse_args()
    site = a.site.rstrip("/")
    template = (a.dist / "index.html").read_text(encoding="utf-8")
    if '<div id="root"></div>' not in template or "<title>" not in template:
        raise SystemExit("index.html is not the app template")
    urls = [f"{site}/"]
    for f in sorted((a.static / "chapter").glob("*/*.json")):
        book, ch = f.parent.name, int(f.stem)
        meta = json.loads(f.read_text(encoding="utf-8"))
        present = meta.get("present", [])
        ed = next((e for e in PROSE if e in present), None)
        if not ed:
            continue
        texts = json.loads((a.static / "text" / ed / book / f"{ch}.json").read_text(encoding="utf-8"))
        name = meta.get("name") or book
        verses = [(v["verse"], (texts.get(str(v["vkey"])) or {}).get("text") or "") for v in meta["verses"]]
        verses = [(n, t) for n, t in verses if t]
        if not verses:
            continue
        title = f"{name} {ch} — Greek, Hebrew, Commentary | Testimonia"
        first = verses[0][1]
        desc = (
            f"Read {name} {ch} with the Greek and Hebrew, classic commentaries, early church fathers and maps. "
            f"{name} {ch}:1: {first}"
        )
        desc = desc[:157] + "…" if len(desc) > 158 else desc
        url = f"{site}/read/{book}/{ch}"
        body = "".join(f"<p><sup>{n}</sup> {html.escape(t)}</p>" for n, t in verses)
        article = (
            f'<div id="root"><main class="prerender"><h1>{html.escape(name)} {ch}</h1>{body}'
            + (
                f'<p><a href="/read/{book}/{ch + 1}">Next chapter</a></p>'
                if (f.parent / f"{ch + 1}.json").exists()
                else ""
            )
            + "</main></div>"
        )
        page = template.replace('<div id="root"></div>', article, 1)
        page = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", page, count=1)
        page = _attr(page, '<meta name="description" content="', html.escape(desc))
        page = _attr(page, '<meta property="og:title" content="', html.escape(title))
        page = _attr(page, '<meta property="og:description" content="', html.escape(desc))
        page = _attr(page, '<link rel="canonical" href="', url)
        out = a.dist / "read" / book / str(ch) / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page, encoding="utf-8")
        urls.append(url)
    (a.dist / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls)
        + "</urlset>\n",
        encoding="utf-8",
    )
    (a.dist / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {site}/sitemap.xml\n", encoding="utf-8"
    )
    print(f"pre-rendered {len(urls) - 1} chapters; sitemap with {len(urls)} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
