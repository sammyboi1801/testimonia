"""Print the sources.yaml fetch lines for the pinned Wikidata query behind curated/rulers.csv (curation aid).

The query (sources/queries/rulers.rq) finds each ruler's Wikidata item through its English Wikipedia title and
returns its "position held" statements with their start and end dates. It runs as one GET per group of realms,
so each URL stays short; the results are pinned like any other download (`testimonia fetch wikidata` records
their SHA-256 in sources.lock.json, and a changed result fails the fetch until `--update` accepts it).

    py tools/wikidata_rulers.py 2026-11-06      # then paste the printed lines under the `wikidata` source

After editing rulers.csv (new rulers or Wikipedia titles), run it again with today's date and re-fetch.
"""

from __future__ import annotations

import csv
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://query.wikidata.org/sparql"
#: realms queried together (one result file per group)
GROUPS = {
    "ane": ("united", "judah", "israel", "egypt", "assyria", "babylon", "persia", "macedon"),
    "hellenistic": ("ptolemaic", "seleucid", "hasmonean", "herodian", "judaea", "officials", "high-priests"),
    "rome": ("rome",),
}


def literal(title: str) -> str:
    return '"' + title.replace("\\", "\\\\").replace('"', '\\"') + '"@en'


def query(titles: list[str]) -> str:
    text = (ROOT / "sources" / "queries" / "rulers.rq").read_text(encoding="utf-8")
    body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    body = body.replace("{titles}", " ".join(literal(t) for t in titles))
    return re.sub(r"\s+", " ", body).strip()


def main(date: str) -> None:
    with (ROOT / "curated" / "rulers.csv").open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    grouped = {realm: group for group, realms in GROUPS.items() for realm in realms}
    missing = sorted({r["realm"] for r in rows} - set(grouped))
    if missing:
        raise SystemExit(f"realms not in any group: {missing}")
    for group in GROUPS:
        titles = sorted({r["wikipedia"] for r in rows if r["wikipedia"] and grouped[r["realm"]] == group})
        url = f"{ENDPOINT}?format=json&query={urllib.parse.quote(query(titles), safe='')}"
        print(f'      - {{ http: "{url}", filename: rulers-{group}-{date}.json, target: wikidata-rulers }}')


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "undated")
