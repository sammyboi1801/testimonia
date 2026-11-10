"""Tell IndexNow search engines (Bing, Yandex, Seznam, Naver…) about every page in the live sitemap.

    py tools/indexnow.py [--site https://testimonia.web.app]

The key is public by design: search engines check it against the key file served at the site root
(web/public/<key>.txt). Run after a deploy that adds or changes pages; resubmitting unchanged pages is harmless.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request

KEY = "203173de4e861f79cb66149f8f3eee4d"
HEADERS = {"User-Agent": "Testimonia (github.com/sammyboi1801/testimonia)"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://testimonia.web.app")
    site = ap.parse_args().site.rstrip("/")
    with urllib.request.urlopen(urllib.request.Request(f"{site}/sitemap.xml", headers=HEADERS), timeout=60) as r:
        urls = re.findall(r"<loc>([^<]+)</loc>", r.read().decode("utf-8"))
    body = {
        "host": site.split("://", 1)[1],
        "key": KEY,
        "keyLocation": f"{site}/{KEY}.txt",
        "urlList": urls,
    }
    req = urllib.request.Request(
        "https://api.indexnow.org/indexnow",
        data=json.dumps(body).encode("utf-8"),
        headers={**HEADERS, "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f"IndexNow: {r.status} for {len(urls)} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
