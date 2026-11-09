"""Write the Bible as static files, so the reader loads chapters from a CDN without asking the server.

For every chapter: ``chapter/{book}/{ch}.json`` (verses, headings, margin marks, previous/next) and one file per
edition, ``text/{edition}/{book}/{ch}.json`` (the verse texts with their footnotes, or the original-language words),
made by the very code the API uses, so the reader merges them into the same chapter it would get from
``/api/chapter``. ``index.json`` lists the editions and books present.
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from .books import BY_OSIS
from .refs import vkey
from .server import api
from .server.store import Store


def _req(store: Store) -> Any:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(store=store)))


def _write(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(raw, encoding="utf-8")
    return len(raw.encode("utf-8"))


def export(db: Path, out: Path) -> dict[str, Any]:
    store = Store(db)
    req = _req(store)
    if out.exists():
        shutil.rmtree(out)
    meta = api.meta(req)
    editions = [e["id"] for e in meta["editions"]]
    chapters = [(b["osis"], c) for b in meta["books"] for c in range(b.get("first_chapter", 1) or 1, b["chapters"] + 1)]
    started = time.time()
    files = size = 0
    have: dict[str, list[str]] = {}
    for book, ch in chapters:
        if book not in BY_OSIS:
            continue
        base = api.chapter(req, book, ch, editions="")
        lo, hi = vkey(book, ch, 0), vkey(book, ch, 999)
        present = {
            r["edition_id"]
            for r in store.all(
                "SELECT DISTINCT edition_id FROM edition_verse WHERE vkey BETWEEN ? AND ? "
                "UNION SELECT DISTINCT edition_id FROM token WHERE vkey BETWEEN ? AND ?",
                (lo, hi, lo, hi),
            )
        }
        for v in base["verses"]:
            v.pop("texts", None)
            v.pop("words", None)
        size += _write(
            out / "chapter" / book / f"{ch}.json",
            {
                **{k: base[k] for k in ("book", "chapter", "name", "verses", "headings", "prev", "next")},
                "present": sorted(present),
            },
        )
        files += 1
        for ed in editions:
            if ed not in present:
                continue
            one = api.chapter(req, book, ch, editions=ed)
            if ed in api.WORD_EDITIONS:
                part = {str(v["vkey"]): v["words"][ed] for v in one["verses"] if v["words"].get(ed)}
            else:
                part = {str(v["vkey"]): v["texts"][ed] for v in one["verses"] if ed in v["texts"]}
            if part:
                size += _write(out / "text" / ed / book / f"{ch}.json", part)
                files += 1
                have.setdefault(ed, []).append(f"{book}.{ch}")
    index = {
        "built": meta.get("build", {}),
        "editions": {ed: len(chs) for ed, chs in have.items()},
        "chapters": len(chapters),
    }
    _write(out / "index.json", index)
    return {"files": files + 1, "bytes": size, "seconds": round(time.time() - started, 1), "chapters": len(chapters)}
