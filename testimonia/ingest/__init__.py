"""Ingest steps — one module per source family. Importing a module registers its steps."""

from __future__ import annotations

import importlib

from .base import STEPS, Context, IngestError, Step, step

#: Modules containing ingest steps, in a sensible default order (dependencies decide the real order).
MODULES = (
    "curated",
    "ebible",
    "openbible",
    "stepbible",
    "verses",
    "btb",
    "hcf",
    "ccel",
    "history",
    "witnesses",
    "macula",
)

__all__ = ["MODULES", "STEPS", "Context", "IngestError", "Step", "load_all", "step"]


def load_all() -> None:
    for name in MODULES:
        importlib.import_module(f"{__name__}.{name}")
