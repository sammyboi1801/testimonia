"""Download the public-domain commentaries from the HelloAO Free Use Bible API, chapter by chapter.

    py tools/fetch_helloao.py               # into $TESTIMONIA_DATA/raw/helloao-commentaries (default ~/TestimoniaData)

Files already downloaded are kept, so the script can be stopped and run again. It goes gently: a handful of
requests a second. See sources/sources.yaml (helloao-commentaries) for the licences.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://bible.helloao.org/api"
COMMENTARIES = [
    "matthew-henry",
    "jamieson-fausset-brown",
    "john-gill",
    "adam-clarke",
    "john-calvin",
    "keil-delitzsch",
    "tyndale",
]
HEADERS = {"User-Agent": "Testimonia (open-source Bible study; github.com/sammyboi1801/testimonia)"}


def get(url: str) -> bytes | None:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 + attempt * 3)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"could not fetch {url}")


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from testimonia import config

    out = config.RAW_DIR / "helloao-commentaries"
    done = fetched = 0
    for cid in COMMENTARIES:
        books_raw = get(f"{API}/c/{cid}/books.json")
        if not books_raw:
            print(f"{cid}: no book list, skipped")
            continue
        books = json.loads(books_raw)["books"]
        (out / cid).mkdir(parents=True, exist_ok=True)
        (out / cid / "books.json").write_bytes(books_raw)
        for b in books:
            for ch in range(1, int(b["numberOfChapters"]) + 1):
                path = out / cid / b["id"] / f"{ch}.json"
                if path.exists():
                    done += 1
                    continue
                data = get(f"{API}/c/{cid}/{b['id']}/{ch}.json")
                if data:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                fetched += 1
                time.sleep(0.15)
        print(f"{cid}: {len(books)} books", flush=True)
    print(f"downloaded {fetched}, already had {done}, in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
