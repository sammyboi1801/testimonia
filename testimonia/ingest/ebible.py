"""Bible translations from eBible.org VPL XML, mapped to hub versification with TVTMS."""

from __future__ import annotations

import csv
import re
from typing import Any

from lxml import etree

from .. import versification as V
from ..books import BY_OSIS
from ..refs import vkey
from . import usfm_notes
from .base import Context, IngestError, step

SOURCE = "ebible"
TVTMS = "stepbible-tvtms"
#: Licence statements in eBible's catalogue that we accept as open.
_OPEN_COPYRIGHT = re.compile(r"public domain|creativecommons\.org/(licenses/by(-sa)?/|publicdomain)|cc0", re.I)
_PILCROW = re.compile(r"\s*¶\s*")


def load_rules(ctx: Context) -> V.Rules:
    """TVTMS rules, parsed once per build and shared between steps."""
    cached = ctx.cache.get("tvtms")
    if isinstance(cached, V.Rules):
        return cached
    folder = ctx.path(TVTMS, "Versification")
    files = sorted(folder.glob("TVTMS*.txt"))
    if not files:
        raise IngestError(f"no TVTMS file in {folder}")
    rules = V.Rules.load(files[0])
    ctx.cache["tvtms"] = rules
    return rules


def _catalogue(ctx: Context) -> dict[str, dict[str, str]]:
    path = ctx.find(SOURCE, "translations.csv")
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return {row["translationId"]: row for row in csv.DictReader(fh)}


_ABOUT_OPEN = re.compile(
    r"Creative Commons Attribution(?:[- ]Share[- ]?Alike)?\s+(?:license\s+)?4\.0|public domain", re.I
)
_ABOUT_RESTRICTED = re.compile(r"Non-?Commercial|No-?Deriv|NoDerivatives", re.I)


def _check_licence(ebible_id: str, row: dict[str, str] | None, about_html: str) -> str:
    """Refuse any edition whose licence is not demonstrably open (catalogue entry, else its about page)."""
    if row is None:
        raise IngestError(f"{ebible_id}: not listed in eBible translations.csv")
    if row.get("Redistributable", "").strip().lower() != "true":
        raise IngestError(f"{ebible_id}: eBible marks it as not redistributable")
    copyright_text = row.get("Copyright", "")
    if _OPEN_COPYRIGHT.search(copyright_text):
        return copyright_text
    about = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", about_html))
    if _ABOUT_OPEN.search(about) and not _ABOUT_RESTRICTED.search(about):
        return f"{copyright_text} — {_ABOUT_OPEN.search(about).group(0)}"  # type: ignore[union-attr]
    raise IngestError(f"{ebible_id}: licence not demonstrably open: {copyright_text!r}")


def clean(text: str) -> tuple[str, str | None]:
    """Return (plain text, markup). Paragraph marks (¶) become <p/> in the markup."""
    raw = text.strip()
    plain = _PILCROW.sub(" ", raw).strip()
    markup = "<p/>" + plain if raw.startswith("¶") else None
    return plain, markup


@step("ebible", sources=[SOURCE, TVTMS], requires=["curated"])
def ingest_ebible(ctx: Context) -> None:
    """Translations (KJV+Apocrypha, WEB, BSB, ASV, YLT, Darby, Webster, LSV, Geneva, Tyndale, DRA, Brenton, Vulgate)."""
    rules = load_rules(ctx)
    catalogue = _catalogue(ctx)
    editions: dict[str, Any] = ctx.source(SOURCE).editions
    for sort, (ebible_id, meta) in enumerate(editions.items(), start=1):
        folder = ctx.find(SOURCE, f"{ebible_id}_vpl")
        about = next(folder.glob("*_about.htm"), None)
        _check_licence(ebible_id, catalogue.get(ebible_id), about.read_text(encoding="utf-8") if about else "")
        xml_file = next(folder.glob("*_vpl.xml"), None)
        if xml_file is None:
            raise IngestError(f"{ebible_id}: no *_vpl.xml found — run `testimonia fetch ebible`")
        rows = [
            (el.get("b"), el.get("c"), el.get("v"), el.text or "") for _, el in etree.iterparse(str(xml_file), tag="v")
        ]
        verses, stats = V.map_bible(rules, rows)
        edition_id = str(meta["id"])
        lang = str(meta.get("language", "eng"))
        ctx.insert(
            "edition",
            [
                "id",
                "title",
                "abbrev",
                "language",
                "script_dir",
                "kind",
                "testament",
                "versification_id",
                "year",
                "base_text",
                "description",
                "sort",
                "source_id",
            ],
            [
                (
                    edition_id,
                    meta["title"],
                    meta.get("abbrev"),
                    lang,
                    "ltr",
                    "translation",
                    _testament(verses),
                    meta.get("versification", "eng"),
                    meta.get("year"),
                    meta.get("base"),
                    f"eBible.org {ebible_id}. {meta.get('notes', '')}".strip(),
                    sort,
                    SOURCE,
                )
            ],
        )
        _notes(ctx, ebible_id, edition_id, verses)
        out = []
        for hv in verses:
            if not hv.text:
                continue
            plain, markup = clean(hv.text)
            native = ",".join(hv.native)
            hub_native = hv.hub.osis
            out.append(
                (
                    edition_id,
                    vkey(hv.hub.book, hv.hub.ch, hv.hub.v),
                    native if native != hub_native else None,
                    plain,
                    markup,
                )
            )
        n = ctx.insert("edition_verse", ["edition_id", "vkey", "native_ref", "text", "markup"], out)
        mapped_by_rule = stats.get("rule", 0)
        merged = stats.get("merged_collisions", 0)
        ctx.log.info(
            "  %-8s %6d verses (%d renumbered by TVTMS%s)",
            edition_id,
            n,
            mapped_by_rule,
            f", {merged} merged" if merged else "",
        )
        if stats.get("unmapped"):
            ctx.log.warning("  %s: %d native verses could not be placed", edition_id, stats["unmapped"])


def _testament(verses: list[V.HubVerse]) -> str:
    tests = {"NT" if BY_OSIS[v.hub.book].testament == "NT" else "OT" for v in verses}
    return "both" if len(tests) > 1 else (tests.pop() if tests else "both")


def _notes(ctx: Context, ebible_id: str, edition_id: str, verses: list[V.HubVerse]) -> None:
    """Translators' footnotes from the USFM edition, placed with the text's own native→hub mapping."""
    try:
        folder = ctx.find(SOURCE, f"{ebible_id}_usfm")
    except IngestError:
        ctx.log.warning("  %s: no USFM download, so no footnotes (run `testimonia fetch ebible`)", ebible_id)
        return
    hub: dict[str, int] = {}
    for hv in verses:
        k = vkey(hv.hub.book, hv.hub.ch, hv.hub.v)
        for native in hv.native:
            hub.setdefault(native, k)
    rows: list[tuple[str, int, int, str, str, str]] = []
    counters: dict[int, int] = {}
    unplaced = 0
    for note in usfm_notes.read_edition(folder):
        ref = usfm_notes.native_ref(note)
        # eBible sometimes letters the first part of a split verse ('1a') where the text has '1', and vice versa
        place: int | None = None
        if ref:
            place = hub.get(ref) or hub.get(ref + "a") or hub.get(ref.rstrip("abcdefghijklmnopqrstuvwxyz"))
        if place is None:
            unplaced += 1
            continue
        counters[place] = counters.get(place, 0) + 1
        rows.append((edition_id, place, counters[place], note.kind, note.body, note.anchor))
    ctx.insert("edition_note", ["edition_id", "vkey", "n", "kind", "body", "anchor"], rows)
    if rows or unplaced:
        ctx.log.info("  %-8s %5d footnotes%s", edition_id, len(rows), f" ({unplaced} unplaced)" if unplaced else "")
