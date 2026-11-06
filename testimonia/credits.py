"""Generate CREDITS.md — the citable list of every data source — from sources/sources.yaml.

The manifest is the single source of truth; CREDITS.md is derived from it and checked in CI
(``testimonia credits --check``) so it can never silently fall out of date. Pinned versions are
taken from sources/sources.lock.json when present.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from . import config, fetch
from .sources import Manifest, Source

CREDITS_FILE = config.PROJECT_DIR / "CREDITS.md"

PHASES = {
    0: "Foundation — texts, words, lexicons, cross references",
    1: "Early Christian & Jewish literature",
    2: "Textual criticism, manuscripts & Dead Sea Scrolls",
    3: "Linguistic data — syntax, semantic domains, parallels",
    4: "Context — people, places, events, maps, commentaries",
    5: "Optional / future",
}


def _md(text: str) -> str:
    return " ".join(text.replace("|", "\\|").split())


def _versions(manifest: Manifest) -> dict[str, str]:
    out: dict[str, set[str]] = defaultdict(set)
    for entry in fetch.load_lock().get("items", {}).values():
        sid = entry.get("source")
        if not sid:
            continue
        if entry.get("commit"):
            out[sid].add(f"git {entry['commit'][:10]}")
        elif entry.get("sha256"):
            out[sid].add(f"fetched {entry.get('fetched_at', '')[:10]}")
    return {k: ", ".join(sorted(v)) for k, v in out.items()}


def _source_block(s: Source, version: str) -> list[str]:
    lines = [f"### {s.name}", ""]
    if s.url:
        lines.append(f"- **Source:** <{s.url}>")
    lines.append(f"- **Licence:** {s.license}" + (" *(ShareAlike)*" if s.share_alike else ""))
    lines.append(f"- **Credit:** {_md(s.attribution)}")
    if s.feeds:
        lines.append(f"- **Used for:** {', '.join(f'`{f}`' for f in s.feeds)}")
    if version:
        lines.append(f"- **Pinned version:** {version}")
    if s.verify:
        lines.append("- **Status:** licence/quality under verification — excluded from public builds")
    if s.editions:
        lines.append("- **Editions:**")
        for eid, info in s.editions.items():
            if isinstance(info, dict):
                lic = info.get("license", "")
                note = info.get("notes", "")
                lines.append(f"  - `{eid}` — {_md(str(note))} ({lic})" if note else f"  - `{eid}` ({lic})")
            else:
                lines.append(f"  - `{eid}` — {_md(str(info))}")
    lines.append("")
    return lines


def render(manifest: Manifest) -> str:
    versions = _versions(manifest)
    out = [
        "# Data sources & credits",
        "",
        "<!-- GENERATED FILE — do not edit. Source of truth: sources/sources.yaml. -->",
        "<!-- Regenerate with `testimonia credits`; CI fails if this file is stale. -->",
        "",
        "Testimonia is built entirely on openly licensed data. This page lists every dataset the build",
        "uses, with the credit line its licence requires. A built `core.db` is distributed under",
        "**CC BY-SA 4.0** as a combination of these sources (see [DATA_LICENSE.md](DATA_LICENSE.md)).",
        "",
        f"**{len(manifest.sources)} sources** · {len(manifest.excluded)} explicitly excluded",
        "",
    ]
    by_phase: dict[int, list[Source]] = defaultdict(list)
    for s in manifest.sources.values():
        by_phase[s.phase].append(s)
    out += ["## Summary", "", "| Source | Licence | Phase |", "|---|---|---|"]
    for phase in sorted(by_phase):
        for s in sorted(by_phase[phase], key=lambda x: x.name.lower()):
            out.append(f"| {_md(s.name)} | {_md(s.license)} | {phase} |")
    out.append("")
    for phase in sorted(by_phase):
        out += [f"## Phase {phase}: {PHASES.get(phase, '')}", ""]
        for s in sorted(by_phase[phase], key=lambda x: x.name.lower()):
            out += _source_block(s, versions.get(s.id, ""))
    if manifest.pending:
        out += ["## Under verification", "", "These are not used in public builds until cleared:", ""]
        out += [f"- `{p}`" for p in manifest.pending]
        out.append("")
    out += [
        "## Not used (not openly licensed)",
        "",
        "Listed so they are not added by mistake. Where useful, the app links to them instead.",
        "",
        "| Dataset | Reason |",
        "|---|---|",
    ]
    out += [f"| `{k}` | {_md(v)} |" for k, v in sorted(manifest.excluded.items())]
    out.append("")
    return "\n".join(out)


def write(manifest: Manifest, path: Path = CREDITS_FILE) -> bool:
    """Write CREDITS.md; returns True if the content changed."""
    text = render(manifest)
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old == text:
        return False
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def is_current(manifest: Manifest, path: Path = CREDITS_FILE) -> bool:
    return path.exists() and path.read_text(encoding="utf-8") == render(manifest)
