"""Paths and runtime settings.

Resolution order for every setting (first wins):
  1. environment variable            e.g.  TESTIMONIA_BTB=D:\\Obsidian\\BTB
  2. <data dir>/config.toml          e.g.  BTB = 'D:\\Obsidian\\BTB'   (keys without the prefix)
  3. built-in default

The data directory itself comes only from TESTIMONIA_DATA or the default (~/TestimoniaData),
because config.toml lives inside it.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Any

PROJECT_DIR = Path(__file__).resolve().parent.parent
SCHEMA_DIR = PROJECT_DIR / "schema"
SOURCES_FILE = PROJECT_DIR / "sources" / "sources.yaml"
LOCK_FILE = PROJECT_DIR / "sources" / "sources.lock.json"
CURATED_DIR = PROJECT_DIR / "curated"
WEB_DIR = PROJECT_DIR / "web"

DATA_DIR = Path(os.environ.get("TESTIMONIA_DATA", str(Path.home() / "TestimoniaData"))).expanduser()
CONFIG_FILE = DATA_DIR / "config.toml"


def _load_file_config() -> dict[str, Any]:
    if not CONFIG_FILE.is_file():
        return {}
    with CONFIG_FILE.open("rb") as fh:
        return {str(k).upper(): v for k, v in tomllib.load(fh).items()}


_FILE = _load_file_config()


def setting(name: str, default: str | None = None) -> str | None:
    """Look up a setting: TESTIMONIA_<NAME> env var, then config.toml, then default."""
    env = os.environ.get(f"TESTIMONIA_{name}")
    if env is not None:
        return env
    if name in _FILE:
        return str(_FILE[name])
    return default


def _path(name: str, default: Path) -> Path:
    return Path(setting(name, str(default)) or str(default)).expanduser()


RAW_DIR = _path("RAW", DATA_DIR / "raw")  # pinned source downloads
BUILD_DIR = _path("BUILD", DATA_DIR / "build")  # generated databases
CORE_DB = _path("CORE_DB", BUILD_DIR / "core.db")
AI_DB = _path("AI_DB", BUILD_DIR / "ai.db")  # optional: embeddings, AI cache, proposals
USER_DIR = _path("USER", DATA_DIR / "user")
USER_DB = _path("USER_DB", USER_DIR / "user.db")
NOTES_DIR = _path("NOTES", USER_DIR / "notes")  # markdown notes (Obsidian-compatible)
LOG_DIR = _path("LOGS", DATA_DIR / "logs")

HOST = setting("HOST", "127.0.0.1") or "127.0.0.1"
PORT = int(setting("PORT", "8765") or "8765")
#: Sent with every HTTP request. Identifies the project; never contains personal data.
USER_AGENT = setting("USER_AGENT", "Testimonia-build/0.1 (open-source Bible study data pipeline)") or ""


def ensure_dirs() -> None:
    """Create the data directories. Called explicitly by commands, never at import time."""
    for d in (DATA_DIR, RAW_DIR, BUILD_DIR, USER_DIR, NOTES_DIR, LOG_DIR):
        d.mkdir(parents=True, exist_ok=True)
