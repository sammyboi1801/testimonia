"""Command-line interface: ``testimonia <command>`` (or ``python -m testimonia``).

Commands
  sources              list data sources, licences and fetch status
  fetch [IDS…]         download sources into the raw data directory (pinned by sources.lock.json)
  build [--only IDS]   build core.db from fetched sources (atomic: replaces core.db only on success)
  validate             run integrity checks against an existing core.db
  info                 show paths, schema versions and database statistics
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from . import __version__, config

log = logging.getLogger("testimonia")


def _setup_logging(verbose: bool) -> Path:
    config.ensure_dirs()
    logfile = config.LOG_DIR / f"testimonia-{datetime.now():%Y%m%d}.log"
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    for h in list(root.handlers):
        root.removeHandler(h)
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(logging.DEBUG if verbose else logging.INFO)
    console.setFormatter(logging.Formatter("%(message)s"))
    fileh = logging.FileHandler(logfile, encoding="utf-8")
    fileh.setLevel(logging.DEBUG)
    fileh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    root.addHandler(console)
    root.addHandler(fileh)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    return logfile


def cmd_sources(args: argparse.Namespace) -> int:
    from . import fetch, sources

    manifest = sources.load()
    lock = fetch.load_lock().get("items", {})
    pinned = {v.get("source") for v in lock.values()}
    print(f"{'id':26} {'ph':>2}  {'licence':22} {'fetch':6} status")
    for s in sorted(manifest.sources.values(), key=lambda s: (s.phase, s.id)):
        status = "pinned" if s.id in pinned else ("—" if not s.fetch else "not fetched")
        flags = " (verify)" if s.verify else ""
        print(f"{s.id:26} {s.phase:>2}  {s.license[:22]:22} {len(s.fetch):>5}  {status}{flags}")
    pending = ", ".join(manifest.pending)
    print(f"\n{len(manifest.sources)} sources · {len(manifest.excluded)} excluded · pending: {pending}")
    return 0


def cmd_credits(args: argparse.Namespace) -> int:
    from . import credits, sources

    manifest = sources.load()
    if args.check:
        if credits.is_current(manifest):
            log.info("CREDITS.md is up to date")
            return 0
        log.error("CREDITS.md is stale — run `testimonia credits` and commit the result")
        return 1
    changed = credits.write(manifest)
    log.info("CREDITS.md %s", "updated" if changed else "already up to date")
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    from . import fetch, sources

    manifest = sources.load()
    ids = args.ids or ([s.id for s in manifest.by_phase(args.phase)] if args.phase is not None else None)
    t0 = time.monotonic()
    results = fetch.fetch(manifest, ids, update=args.update)
    new = sum(1 for r in results if not r.skipped)
    log.info("fetched %d item(s), %d already up to date, in %.0fs", new, len(results) - new, time.monotonic() - t0)
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from . import build

    report = build.build(only=args.only, public=args.public, keep_going=args.keep_going)
    return 0 if report.ok else 1


def cmd_validate(args: argparse.Namespace) -> int:
    from . import db, validate

    con = db.open_core()
    problems = validate.run(con)
    for p in problems:
        log.error("%s", p)
    log.info("validation: %s", "OK" if not problems else f"{len(problems)} problem(s)")
    return 0 if not problems else 1


def cmd_serve(args: argparse.Namespace) -> int:
    import threading
    import webbrowser

    import uvicorn

    from .server.app import create_app

    app = create_app()
    url = f"http://{args.host}:{args.port}"
    log.info("Testimonia running at %s  (Ctrl+C to stop)", url)
    if args.open:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    from . import db

    print(f"Testimonia {__version__}")
    for name in ("DATA_DIR", "RAW_DIR", "CORE_DB", "AI_DB", "USER_DB", "NOTES_DIR", "LOG_DIR"):
        print(f"  {name:10} {getattr(config, name)}")
    print(f"  config     {config.CONFIG_FILE} ({'present' if config.CONFIG_FILE.exists() else 'absent'})")
    print(f"  core schema v{db.core_schema_version()}")
    if config.CORE_DB.exists():
        con = db.open_core()
        for meta_key, value in con.execute("SELECT key, value FROM meta ORDER BY key"):
            print(f"  meta.{meta_key} = {value}")
        rows = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'fts_%' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for (name,) in rows:
            n = con.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            if n:
                print(f"  {name:24} {n:>12,}")
    else:
        print("  core.db not built yet — run `testimonia fetch` then `testimonia build`")
    return 0


def _utf8_console() -> None:
    """Windows consoles default to a legacy code page; never crash or garble on Greek/Hebrew."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def main(argv: Sequence[str] | None = None) -> int:
    _utf8_console()
    parser = argparse.ArgumentParser(prog="testimonia", description="Testimonia data pipeline")
    parser.add_argument("--version", action="version", version=f"testimonia {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug output")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("sources", help="list data sources").set_defaults(func=cmd_sources)

    p = sub.add_parser("credits", help="generate CREDITS.md from the source manifest")
    p.add_argument("--check", action="store_true", help="fail if CREDITS.md is out of date (CI)")
    p.set_defaults(func=cmd_credits)

    p = sub.add_parser("fetch", help="download sources")
    p.add_argument("ids", nargs="*", help="source ids (default: all fetchable)")
    p.add_argument("--phase", type=int, help="fetch every source up to this build phase")
    p.add_argument("--update", action="store_true", help="move pinned versions forward")
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("build", help="build core.db")
    p.add_argument("--only", nargs="*", help="run only these ingest steps (and their dependencies)")
    p.add_argument("--public", action="store_true", help="exclude sources not cleared for redistribution")
    p.add_argument("--keep-going", action="store_true", help="continue past failing optional steps")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("serve", help="run the Testimonia app in your browser")
    p.add_argument("--host", default=config.HOST)
    p.add_argument("--port", type=int, default=config.PORT)
    p.add_argument("--open", action="store_true", help="open the browser automatically")
    p.set_defaults(func=cmd_serve)

    sub.add_parser("validate", help="check core.db integrity").set_defaults(func=cmd_validate)
    sub.add_parser("info", help="paths and database statistics").set_defaults(func=cmd_info)

    args = parser.parse_args(argv)
    logfile = _setup_logging(args.verbose)
    log.debug("log file: %s", logfile)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        log.error("interrupted")
        return 130
    except Exception as exc:  # top-level: report cleanly, full traceback in the log file
        log.error("error: %s", exc)
        log.debug("traceback", exc_info=True)
        log.error("(details in %s)", logfile)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
