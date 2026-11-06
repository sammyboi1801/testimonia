"""Container entry point: make sure the database is there, then serve the app on 0.0.0.0:$PORT.

If the database is missing and TESTIMONIA_CORE_DB_URL is set, it is downloaded once (atomically, with an
optional TESTIMONIA_CORE_DB_SHA256 check). A public server never lets the assistant call private network
addresses (see testimonia/server/agent.py).
"""

from __future__ import annotations

import hashlib
import os
import sys

import httpx

from testimonia import config


def ensure_database() -> None:
    db = config.CORE_DB
    if db.exists():
        return
    url = os.environ.get("TESTIMONIA_CORE_DB_URL")
    if not url:
        sys.exit(f"No database at {db}. Mount one there, or set TESTIMONIA_CORE_DB_URL to download it.")
    db.parent.mkdir(parents=True, exist_ok=True)
    part = db.with_suffix(".download")
    digest = hashlib.sha256()
    print(f"Downloading the database from {url} …", flush=True)
    with httpx.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(60, read=300)) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with part.open("wb") as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if total and done % (100 << 20) < (1 << 20):
                    print(f"  {done >> 20} / {total >> 20} MB", flush=True)
    expected = os.environ.get("TESTIMONIA_CORE_DB_SHA256")
    if expected and digest.hexdigest() != expected.lower():
        part.unlink()
        sys.exit("Database checksum mismatch — refusing to start.")
    part.replace(db)
    print("Database ready.", flush=True)


def main() -> None:
    ensure_database()
    port = os.environ.get("PORT", "7860")
    os.execvp(sys.executable, [sys.executable, "-m", "testimonia", "serve", "--host", "0.0.0.0", "--port", port])


if __name__ == "__main__":
    main()
