"""`python -m testimonia` entry point."""

from .cli import main

if __name__ == "__main__":  # guard: multiprocessing workers re-import this module on Windows
    raise SystemExit(main())
