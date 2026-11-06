"""Suggest Wikipedia articles for library works (curation aid; not part of the build).

For every author in curated/people.csv with a Wikipedia title, look up the author's Wikidata item and every
work Wikidata records as written by them (P50) that has an English Wikipedia article. Each of our works is
matched to the candidate whose title shares the most significant words. Anonymous works are matched against
English Wikipedia search. The output is a review sheet; accepted rows are copied into curated/works.csv by hand.

    py tools/match_wikipedia_works.py <core.db> <out.csv>
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Testimonia/0.2 (open-source Bible study app; curation script)"}
STOP = {
    *[
        "the",
        "a",
        "an",
        "of",
        "on",
        "to",
        "and",
        "in",
        "against",
        "concerning",
        "from",
        "his",
        "her",
        "its",
        "by",
        "with",
        "for",
    ],
    *["book", "books", "treatise", "letter", "epistle", "epistles", "fragments", "extant", "writings", "same"],
}


ANONYMOUS = ("nt-apocrypha", "ot-pseudepigrapha", "apostolic-father", "church-father", "council")


def get(url: str) -> dict:
    err: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception as e:  # polite retry on throttling
            err = e
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"{url}: {err}")


def words(s: str) -> set[str]:
    s = re.sub(r"\(.*?\)", " ", s.lower())
    return {w for w in re.findall(r"[a-z]+", s) if w not in STOP and len(w) > 2}


def qids_for(titles: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(titles), 40):
        q = get(
            "https://en.wikipedia.org/w/api.php?"
            + urllib.parse.urlencode(
                {
                    "action": "query",
                    "format": "json",
                    "redirects": 1,
                    "prop": "pageprops",
                    "ppprop": "wikibase_item",
                    "titles": "|".join(titles[i : i + 40]),
                }
            )
        )["query"]
        alias = {n["from"]: n["to"] for n in q.get("normalized", []) + q.get("redirects", [])}
        by_title = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in q["pages"].values()}
        for t in titles[i : i + 40]:
            t2 = alias.get(alias.get(t, t), alias.get(t, t))
            if by_title.get(t2):
                out[t] = by_title[t2]
    return out


def works_by(qid: str) -> list[tuple[str, str]]:
    query = f"""SELECT ?w ?article WHERE {{ ?w wdt:P50 wd:{qid} .
      ?article schema:about ?w ; schema:isPartOf <https://en.wikipedia.org/> . }}"""
    res = get("https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"}))
    out = []
    for b in res["results"]["bindings"]:
        article = urllib.parse.unquote(b["article"]["value"].rsplit("/", 1)[1]).replace("_", " ")
        out.append((b["w"]["value"].rsplit("/", 1)[1], article))
    return out


def search(title: str) -> str | None:
    try:
        res = get(
            "https://en.wikipedia.org/w/api.php?"
            + urllib.parse.urlencode(
                {"action": "query", "list": "search", "srsearch": title[:120], "srlimit": 3, "format": "json"}
            )
        )
    except RuntimeError as e:
        print("search failed:", e)
        return None
    hits = res["query"]["search"]
    return hits[0]["title"] if hits else None


def main(db: str, out: str) -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    with (Path(__file__).parent.parent / "curated" / "people.csv").open(encoding="utf-8") as fh:
        people = {r["id"]: r for r in csv.DictReader(fh)}
    con = sqlite3.connect(db)
    works = con.execute("SELECT id, title, author_id, category FROM work ORDER BY author_id, title").fetchall()
    author_q = qids_for([p["wikipedia"] for p in people.values() if p["wikipedia"]])
    rows = []
    cache: dict[str, list[tuple[str, str]]] = {}
    for wid, title, author, category in works:
        p = people.get(author or "")
        best, score, method = None, 0.0, ""
        if p and p["wikipedia"] in author_q:
            q = author_q[p["wikipedia"]]
            if q not in cache:
                cache[q] = works_by(q)
                time.sleep(0.5)
            mine = words(title)
            for _wq, art in cache[q]:
                theirs = words(art)
                if mine and theirs:
                    s = len(mine & theirs) / len(mine | theirs)
                    if s > score:
                        best, score, method = art, s, "wikidata-author"
        elif not author and category in ANONYMOUS:
            hit = search(re.sub(r"[;:].*$", "", title))
            time.sleep(0.3)
            if hit:
                overlap = len(words(title) & words(hit)) / max(1, len(words(title) | words(hit)))
                best, score, method = hit, overlap, "search"
        rows.append((wid, title, author or "", best or "", round(score, 2), method))
    with open(out, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["work_id", "title", "author_id", "wikipedia", "score", "method"])
        w.writerows(rows)
    print(f"{sum(1 for r in rows if r[3])} of {len(rows)} works have a candidate → {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
