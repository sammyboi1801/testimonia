"""Check that the live site works end to end: pages, the Bible data, the server, share links.

    py tools/smoke.py                                  (the live site)
    py tools/smoke.py https://testimonia--test-x.web.app   (a preview channel)

Exits 1 and lists what failed. Standard library only, so it runs anywhere (the deploy script, GitHub Actions).
Each check is tried twice, so one slow cold start does not count as an outage.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable

SITE = "https://testimonia.web.app"
SERVER = "https://35-209-1-30.sslip.io"  # the assistant talks to it directly
Check = Callable[[int, dict[str, str], bytes], str | None]  # returns what is wrong, or None


def get(url: str, timeout: float = 30) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "testimonia-smoke/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def has(*needles: str) -> Check:
    def check(status: int, headers: dict[str, str], body: bytes) -> str | None:
        if status != 200:
            return f"status {status}"
        text = body.decode("utf-8", "replace")
        missing = [n for n in needles if n not in text]
        return f"missing {missing}" if missing else None

    return check


def json_with(key: str) -> Check:
    def check(status: int, headers: dict[str, str], body: bytes) -> str | None:
        if status != 200:
            return f"status {status}"
        try:
            data = json.loads(body)
        except ValueError:
            return "not JSON"
        return None if key in data else f"no {key!r} in the JSON"

    return check


def image(status: int, headers: dict[str, str], body: bytes) -> str | None:
    if status != 200:
        return f"status {status}"
    if not headers.get("content-type", "").startswith("image/png") or len(body) < 5000:
        return f"not a PNG ({headers.get('content-type')}, {len(body)} bytes)"
    return None


def secure_headers(status: int, headers: dict[str, str], body: bytes) -> str | None:
    if status != 200:
        return f"status {status}"
    want = ["x-content-type-options", "referrer-policy", "content-security-policy", "strict-transport-security"]
    missing = [h for h in want if h not in headers]
    return f"missing headers {missing}" if missing else None


def checks(site: str, server: str | None) -> list[tuple[str, str, Check]]:
    t = int(time.time())  # past any cached copy, so the server is really asked
    out: list[tuple[str, str, Check]] = [
        ("home page", f"{site}/", has("<title>", "Testimonia")),
        ("security headers", f"{site}/", secure_headers),
        ("chapter page", f"{site}/read/John/3", has("John 3")),
        ("chapter data", f"{site}/data/chapter/John/3.json", json_with("verses")),
        ("verse data", f"{site}/data/verse/John.3.16.json?r=2", json_with("texts")),
        ("library data", f"{site}/data/lib/meta.json", json_with("books")),
        ("server via the site", f"{site}/api/health?t={t}", json_with("status")),
        ("share link", f"{site}/v/John.3.16", has("og:image")),
        ("share picture", f"{site}/og/John.3.16.png", image),
        ("sitemap", f"{site}/sitemap.xml", has("<urlset")),
    ]
    if server:
        out.append(("server direct (assistant)", f"{server}/api/health?t={t}", json_with("status")))
    return out


def run(site: str, server: str | None) -> list[str]:
    failed = []
    for name, url, check in checks(site.rstrip("/"), server):
        problem: str | None = None
        for attempt in range(2):
            try:
                problem = check(*get(url))
            except Exception as e:  # timeouts, DNS, TLS: all count as down
                problem = f"{type(e).__name__}: {e}"
            if problem is None:
                break
            if attempt == 0:
                time.sleep(5)
        print(f"{'ok  ' if problem is None else 'FAIL'} {name}{'' if problem is None else f': {problem} ({url})'}")
        if problem:
            failed.append(f"{name}: {problem} ({url})")
    return failed


def main() -> int:
    site = sys.argv[1] if len(sys.argv) > 1 else SITE
    server = SERVER if site.rstrip("/") == SITE else None  # a preview shares the live server; checked on live runs
    failed = run(site, server)
    print(f"\n{len(failed)} failed" if failed else "\nall good")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
