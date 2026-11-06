"""Cross references from OpenBible.info (CC BY), with community relevance votes."""

from __future__ import annotations

import csv
from collections.abc import Iterator

from ..refs import parse_osis
from .base import Context, IngestError, batched, step

SOURCE = "openbible-xref"


@step("openbible-xref", sources=[SOURCE], requires=["curated"])
def ingest_crossrefs(ctx: Context) -> None:
    """OpenBible.info cross references (≈345k, voted)."""
    folder = ctx.paths(SOURCE)[0]
    files = list(folder.rglob("cross_references.txt"))
    if not files:
        raise IngestError(f"cross_references.txt not found under {folder}")
    bad = 0
    total = 0

    def rows() -> Iterator[tuple[int, int, int, int, int | None, str]]:
        nonlocal bad
        with files[0].open(encoding="utf-8", newline="") as fh:
            reader = csv.reader(fh, delimiter="\t")
            next(reader, None)  # header: From Verse, To Verse, Votes, …
            for rec in reader:
                if len(rec) < 3:
                    bad += 1
                    continue
                src, dst = parse_osis(rec[0]), parse_osis(rec[1])
                try:
                    votes = int(rec[2])
                except ValueError:
                    votes = None
                if src is None or dst is None:
                    bad += 1
                    continue
                yield (src.start, src.end, dst.start, dst.end, votes, SOURCE)

    for batch in batched(rows()):
        total += ctx.insert("crossref", ["src_start", "src_end", "dst_start", "dst_end", "votes", "source_id"], batch)
    if bad:
        ctx.log.warning("  %d cross-reference rows skipped (unparseable references)", bad)
    if total < 300_000:
        raise IngestError(f"only {total} cross references loaded — input looks truncated")
