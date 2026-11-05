# Contributing to Testimonia

Thank you for helping. A few rules keep the project healthy and legally clean.

## Data contributions

- **Open data only.** Before proposing a dataset, confirm its licence is public domain, CC0,
  CC BY or CC BY-SA, and add it to [`sources/sources.yaml`](sources/sources.yaml) with the exact
  licence and attribution. NC/ND/"personal use"/unlicensed data will not be accepted.
- **Curated tables** (`curated/*.csv`) must cite a source for every row (`citation` column):
  a public-domain primary text, a CC BY-SA Wikipedia table, or a published reference.
- Where scholars disagree (dates, chronologies, attributions), **add a row per position** under
  its own chronology system instead of choosing one.

## Code contributions

- Python ≥ 3.11. Run `pytest`, `ruff check .`, `ruff format --check .` and `mypy testimonia` before
  opening a pull request; CI runs the same checks on Linux and Windows.
- Every ingest module is idempotent: it deletes and re-inserts only rows with its own `source_id`.
- Schema changes: edit `schema/core.sql` **and bump `PRAGMA user_version`**. For the user database,
  never edit an existing migration — add `schema/user_migrations/NNNN_description.sql`.
- Add tests for parsers and for any new constraint.

## Commit messages

Use the imperative mood and explain *why*: `Add TVTMS versification ingest`,
`Fix Psalm title mapping for LXX numbering`.
