"""Load and validate the data-source manifest (sources/sources.yaml).

The manifest is the single declaration of every dataset: where it comes from, its licence,
the attribution it requires, and *how to fetch it* (the ``fetch:`` block). Validation runs on
every load so a malformed or non-open entry fails fast with a clear message.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .config import SOURCES_FILE

#: Licences acceptable in a distributable build (prefix match, case-insensitive).
OPEN_LICENSE_PREFIXES = ("pd", "cc0", "cc-by-4.0", "cc-by-3.0", "cc-by-sa", "mit", "per-translation")
SOURCE_KINDS = ("dataset", "curated", "machine", "api")


class ManifestError(ValueError):
    """The source manifest is malformed or declares a non-open licence."""


@dataclass(frozen=True)
class FetchItem:
    """One thing to download for a source."""

    kind: str  # 'http' | 'git' | 'local'
    url: str = ""  # http: file URL; git: repository URL
    target: str = ""  # directory under raw/ (defaults to the source id); shared targets dedupe
    filename: str = ""  # http: saved file name (defaults to the URL basename)
    extract: bool = False  # http: unzip / gunzip after download
    ref: str = ""  # git: branch or tag (default: remote HEAD)
    sparse: tuple[str, ...] = ()  # git: sparse-checkout directories
    env: str = ""  # local: environment/config key that points at an existing copy
    optional: bool = False

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.kind, self.url or self.env, self.target)


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    license: str
    attribution: str
    url: str = ""
    share_alike: bool = False
    kind: str = "dataset"
    public: bool = True
    phase: int = 0
    feeds: tuple[str, ...] = ()
    fetch: tuple[FetchItem, ...] = ()
    editions: dict[str, Any] = field(default_factory=dict)
    notes: str = ""
    verify: bool = False

    @property
    def is_open(self) -> bool:
        lic = self.license.strip().lower()
        return any(lic.startswith(p) for p in OPEN_LICENSE_PREFIXES)


@dataclass(frozen=True)
class Manifest:
    sources: dict[str, Source]
    excluded: dict[str, str]
    pending: list[str]

    def get(self, source_id: str) -> Source:
        try:
            return self.sources[source_id]
        except KeyError:
            raise ManifestError(f"unknown source id {source_id!r}") from None

    def by_phase(self, max_phase: int) -> list[Source]:
        return [s for s in self.sources.values() if s.phase <= max_phase]


def _fetch_items(source_id: str, raw: Any) -> tuple[FetchItem, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ManifestError(f"{source_id}: fetch must be a list")
    items = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict) or len({"http", "git", "local"} & entry.keys()) != 1:
            raise ManifestError(f"{source_id}: fetch[{i}] needs exactly one of http/git/local")
        kind = next(k for k in ("http", "git", "local") if k in entry)
        sparse = entry.get("sparse") or ()
        if isinstance(sparse, str):
            sparse = (sparse,)
        items.append(
            FetchItem(
                kind=kind,
                url=str(entry[kind]) if kind != "local" else "",
                env=str(entry[kind]) if kind == "local" else "",
                target=str(entry.get("target") or source_id),
                filename=str(entry.get("filename") or ""),
                extract=bool(entry.get("extract", False)),
                ref=str(entry.get("ref") or ""),
                sparse=tuple(str(s) for s in sparse),
                optional=bool(entry.get("optional", False)),
            )
        )
    return tuple(items)


def _source(raw: dict[str, Any]) -> Source:
    for req in ("id", "name", "license", "attribution"):
        if not raw.get(req):
            raise ManifestError(f"source {raw.get('id', '?')!r} is missing required field {req!r}")
    sid = str(raw["id"])
    kind = str(raw.get("kind", "dataset"))
    if kind not in SOURCE_KINDS:
        raise ManifestError(f"{sid}: kind must be one of {SOURCE_KINDS}")
    src = Source(
        id=sid,
        name=str(raw["name"]),
        license=str(raw["license"]),
        attribution=str(raw["attribution"]),
        url=str(raw.get("url") or ""),
        share_alike=bool(raw.get("share_alike", False)),
        kind=kind,
        public=bool(raw.get("public", True)),
        phase=int(raw.get("phase", 0)),
        feeds=tuple(str(f) for f in raw.get("feeds") or ()),
        fetch=_fetch_items(sid, raw.get("fetch")),
        editions=dict(raw.get("editions") or {}),
        notes=str(raw.get("notes") or "").strip(),
        verify=bool(raw.get("verify", False)),
    )
    if not src.is_open:
        raise ManifestError(f"{sid}: licence {src.license!r} is not an accepted open licence")
    return src


def load(path: Path = SOURCES_FILE) -> Manifest:
    """Load and validate the manifest."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    sources: dict[str, Source] = {}
    for raw in data.get("sources") or []:
        src = _source(raw)
        if src.id in sources:
            raise ManifestError(f"duplicate source id {src.id!r}")
        sources[src.id] = src
    excluded = {str(e["id"]): str(e.get("reason", "")) for e in data.get("excluded") or []}
    clash = excluded.keys() & sources.keys()
    if clash:
        raise ManifestError(f"source(s) both included and excluded: {sorted(clash)}")
    pending = [next(iter(v)) if isinstance(v, dict) else str(v) for v in data.get("verify") or []]
    return Manifest(sources, excluded, pending)
