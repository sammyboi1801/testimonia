"""Download source datasets into the raw data directory, reproducibly.

* HTTP files are streamed to ``<name>.part`` and atomically renamed; SHA-256 is recorded.
* Archives are extracted with path-traversal protection.
* Git repositories are shallow, blob-filtered and optionally sparse clones.
* ``sources/sources.lock.json`` pins what was fetched (file hashes, git commits). A normal fetch
  reproduces the pinned versions and fails loudly if a file changed upstream; ``--update`` moves
  the pins forward deliberately.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import shutil
import subprocess
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

import httpx

from . import config
from .sources import FetchItem, Manifest, Source

log = logging.getLogger(__name__)

RETRIES = 4
TIMEOUT = httpx.Timeout(60.0, connect=20.0)
CHUNK = 1 << 20


class FetchError(RuntimeError):
    """A download failed or did not match its pinned version."""


@dataclass
class FetchResult:
    source_id: str
    item: FetchItem
    path: Path
    sha256: str = ""
    size: int = 0
    commit: str = ""
    skipped: bool = False


# ---------------------------------------------------------------------------- lock file


def load_lock(path: Path = config.LOCK_FILE) -> dict[str, Any]:
    if path.is_file():
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return data
    return {"version": 1, "items": {}}


def save_lock(lock: dict[str, Any], path: Path = config.LOCK_FILE) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(lock, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def lock_key(item: FetchItem) -> str:
    return f"{item.kind}|{item.url or item.env}|{item.target}|{item.filename}"


# ---------------------------------------------------------------------------- helpers


def target_dir(item: FetchItem) -> Path:
    return config.RAW_DIR / item.target


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def _filename(item: FetchItem) -> str:
    return item.filename or PurePosixPath(urlparse(item.url).path).name or "download"


def _safe_extract_zip(archive: Path, dest: Path) -> None:
    """Extract a zip, refusing entries that would escape ``dest`` (zip-slip)."""
    dest = dest.resolve()
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            out = (dest / member.filename).resolve()
            if not out.is_relative_to(dest):
                raise FetchError(f"unsafe path in archive {archive.name}: {member.filename!r}")
        tmp = dest.with_name(dest.name + ".extracting")
        shutil.rmtree(tmp, ignore_errors=True)
        zf.extractall(tmp)
    shutil.rmtree(dest, ignore_errors=True)
    tmp.replace(dest)


def _extract(archive: Path) -> Path:
    if archive.suffix == ".zip":
        dest = archive.with_suffix("")
        _safe_extract_zip(archive, dest)
        return dest
    if archive.suffix == ".gz":
        dest = archive.with_suffix("")
        with gzip.open(archive, "rb") as src, dest.open("wb") as out:
            shutil.copyfileobj(src, out, CHUNK)
        return dest
    raise FetchError(f"don't know how to extract {archive.name}")


# ---------------------------------------------------------------------------- http


def _download(client: httpx.Client, url: str, dest: Path) -> None:
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, RETRIES + 1):
        try:
            with client.stream("GET", url) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("content-length") or 0)
                done, last_log = 0, time.monotonic()
                with part.open("wb") as fh:
                    for chunk in resp.iter_bytes(CHUNK):
                        fh.write(chunk)
                        done += len(chunk)
                        if time.monotonic() - last_log > 5:
                            pct = f" ({100 * done / total:.0f}%)" if total else ""
                            log.info("  … %s: %.1f MB%s", dest.name, done / 1e6, pct)
                            last_log = time.monotonic()
            part.replace(dest)
            return
        except (httpx.HTTPError, OSError) as exc:
            part.unlink(missing_ok=True)
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status is not None and 400 <= status < 500 and status != 429:
                raise FetchError(f"{url}: HTTP {status}") from exc
            if attempt == RETRIES:
                raise FetchError(f"{url}: failed after {RETRIES} attempts: {exc}") from exc
            wait = 2**attempt
            log.warning("  retry %d/%d for %s in %ds (%s)", attempt, RETRIES - 1, url, wait, exc)
            time.sleep(wait)


def fetch_http(
    client: httpx.Client, source_id: str, item: FetchItem, pinned: dict[str, Any] | None, update: bool
) -> FetchResult:
    folder = target_dir(item)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / _filename(item)
    if dest.exists() and pinned and not update and _sha256(dest) == pinned.get("sha256"):
        result_path = dest.with_suffix("") if item.extract else dest
        if item.extract and not result_path.exists():
            _extract(dest)
        return FetchResult(source_id, item, result_path, pinned["sha256"], dest.stat().st_size, skipped=True)
    log.info("  downloading %s", item.url)
    _download(client, item.url, dest)
    digest = _sha256(dest)
    if pinned and not update and pinned.get("sha256") and pinned["sha256"] != digest:
        raise FetchError(
            f"{source_id}: {dest.name} changed upstream (pinned {pinned['sha256'][:12]}…, got {digest[:12]}…). "
            "Review the change, then run `testimonia fetch --update` to accept it."
        )
    path = _extract(dest) if item.extract else dest
    return FetchResult(source_id, item, path, digest, dest.stat().st_size)


# ---------------------------------------------------------------------------- git


def _git(*args: str, cwd: Path | None = None) -> str:
    proc = subprocess.run(
        ["git", "-c", "advice.detachedHead=false", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if proc.returncode != 0:
        raise FetchError(f"git {' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.strip()


def fetch_git(source_id: str, item: FetchItem, pinned: dict[str, Any] | None, update: bool) -> FetchResult:
    repo = target_dir(item)
    if not (repo / ".git").exists():
        shutil.rmtree(repo, ignore_errors=True)
        repo.parent.mkdir(parents=True, exist_ok=True)
        log.info("  cloning %s", item.url)
        args = ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout"]
        if item.ref:
            args += ["--branch", item.ref]
        _git(*args, item.url, str(repo))
        if item.sparse:
            _git("sparse-checkout", "init", "--cone", cwd=repo)
            _git("sparse-checkout", "set", *item.sparse, cwd=repo)
        _git("checkout", cwd=repo)
    elif update:
        log.info("  updating %s", item.url)
        _git("fetch", "--depth", "1", "origin", item.ref or "HEAD", cwd=repo)
        _git("checkout", "--force", "FETCH_HEAD", cwd=repo)
    want = (pinned or {}).get("commit")
    head = _git("rev-parse", "HEAD", cwd=repo)
    if want and not update and head != want:
        log.info("  checking out pinned commit %s", want[:12])
        _git("fetch", "--depth", "1", "origin", want, cwd=repo)
        _git("checkout", "--force", want, cwd=repo)
        head = want
    return FetchResult(source_id, item, repo, commit=head, skipped=bool(want and head == want and not update))


# ---------------------------------------------------------------------------- local


def fetch_local(source_id: str, item: FetchItem) -> FetchResult | None:
    value = config.setting(item.env)
    if value and Path(value).expanduser().exists():
        path = Path(value).expanduser()
        commit = ""
        if (path / ".git").exists():
            try:
                commit = _git("-c", f"safe.directory={path.as_posix()}", "rev-parse", "HEAD", cwd=path)
            except FetchError:
                commit = ""
        log.info("  using local copy %s", path)
        return FetchResult(source_id, item, path, commit=commit, skipped=True)
    return None


# ---------------------------------------------------------------------------- orchestration


def resolve_paths(source: Source) -> list[Path]:
    """Where a source's data lives locally (after fetch), honouring local overrides."""
    paths: list[Path] = []
    local_found = False
    for item in source.fetch:
        if item.kind == "local":
            value = config.setting(item.env)
            if value and Path(value).expanduser().exists():
                paths.append(Path(value).expanduser())
                local_found = True
            continue
        if local_found and item.kind == "git":
            continue  # a local copy replaces the git clone fallback
        folder = target_dir(item)
        if item.kind == "http":
            f = folder / _filename(item)
            paths.append(f.with_suffix("") if item.extract else f)
        else:
            paths.append(folder)
    return paths


def fetch(manifest: Manifest, source_ids: list[str] | None = None, *, update: bool = False) -> list[FetchResult]:
    """Fetch the given sources (default: all with a fetch block) and update the lock file."""
    config.ensure_dirs()
    lock = load_lock()
    pins: dict[str, Any] = lock.setdefault("items", {})
    selected = [manifest.get(s) for s in source_ids] if source_ids else list(manifest.sources.values())
    results: list[FetchResult] = []
    seen: set[tuple[str, str, str]] = set()
    headers = {"User-Agent": config.USER_AGENT}
    with httpx.Client(headers=headers, timeout=TIMEOUT, follow_redirects=True) as client:
        for source in selected:
            if not source.fetch:
                continue
            log.info("fetch %s", source.id)
            local_hit = False
            for item in source.fetch:
                if item.key in seen:
                    continue
                if item.kind == "local":
                    res = fetch_local(source.id, item)
                    if res:
                        local_hit = True
                        results.append(res)
                    continue
                if local_hit and item.kind == "git":
                    continue
                seen.add(item.key)
                key = lock_key(item)
                try:
                    if item.kind == "http":
                        res = fetch_http(client, source.id, item, pins.get(key), update)
                    else:
                        res = fetch_git(source.id, item, pins.get(key), update)
                except FetchError:
                    if item.optional:
                        log.warning("  optional item failed: %s", item.url)
                        continue
                    raise
                results.append(res)
                entry: dict[str, Any] = {
                    "source": source.id,
                    "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
                }
                if res.sha256:
                    entry |= {"sha256": res.sha256, "size": res.size}
                if res.commit:
                    entry["commit"] = res.commit
                if not res.skipped or key not in pins:
                    pins[key] = entry
            save_lock(lock)
    return results
