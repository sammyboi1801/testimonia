"""Paths and runtime settings.

Every value can be overridden with an environment variable, so the same code runs on a
developer machine, in CI, and in a packaged build.
"""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
SCHEMA_DIR = PROJECT_DIR / "schema"
SOURCES_FILE = PROJECT_DIR / "sources" / "sources.yaml"
CURATED_DIR = PROJECT_DIR / "curated"
WEB_DIR = PROJECT_DIR / "web"


def _path(env: str, default: Path) -> Path:
    return Path(os.environ.get(env, str(default))).expanduser()


#: Root of all generated / downloaded data (kept outside the repository).
DATA_DIR = _path("TESTIMONIA_DATA", Path.home() / "TestimoniaData")
RAW_DIR = _path("TESTIMONIA_RAW", DATA_DIR / "raw")  # pinned source downloads
BUILD_DIR = _path("TESTIMONIA_BUILD", DATA_DIR / "build")  # generated core.db
CORE_DB = _path("TESTIMONIA_CORE_DB", BUILD_DIR / "core.db")
AI_DB = _path("TESTIMONIA_AI_DB", BUILD_DIR / "ai.db")  # optional: embeddings, AI cache, proposals
USER_DIR = _path("TESTIMONIA_USER", DATA_DIR / "user")
USER_DB = _path("TESTIMONIA_USER_DB", USER_DIR / "user.db")
NOTES_DIR = _path("TESTIMONIA_NOTES", USER_DIR / "notes")  # markdown notes (Obsidian-compatible)

#: Optional local BTB vault (otherwise the build clones github.com/revjude/BTB into RAW_DIR).
BTB_DIR = _path("TESTIMONIA_BTB", RAW_DIR / "btb")

HOST = os.environ.get("TESTIMONIA_HOST", "127.0.0.1")
PORT = int(os.environ.get("TESTIMONIA_PORT", "8765"))


def ensure_dirs() -> None:
    """Create the data directories. Called explicitly by commands, never at import time."""
    for d in (DATA_DIR, RAW_DIR, BUILD_DIR, USER_DIR, NOTES_DIR):
        d.mkdir(parents=True, exist_ok=True)
