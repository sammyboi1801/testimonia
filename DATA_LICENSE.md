# Data licensing

Testimonia separates **code** from **data**.

| What | Licence |
|---|---|
| Source code (`testimonia/`, `web/`, `tests/`, build scripts) | MIT — see [`LICENSE`](LICENSE) |
| Schema files (`schema/`) and documentation (`docs/`) | MIT |
| Curated tables in `curated/` (chronologies, canon lists, regnal dates, work catalogue…) | **CC BY-SA 4.0** — they are encoded partly from CC BY-SA sources such as Wikipedia |
| A built `core.db` (generated, not stored in this repository) | **CC BY-SA 4.0**, as a combination of the datasets listed in [`sources/sources.yaml`](sources/sources.yaml) |

## Rules for data

1. Only datasets that are **public domain, CC0, CC BY or CC BY-SA** may be ingested into a
   distributable build. Non-commercial (NC), no-derivatives (ND), "personal use" and unlicensed
   data are not allowed, even if freely downloadable.
2. Every dataset is declared in `sources/sources.yaml` with its URL, exact licence and required
   attribution. Every row in `core.db` records the `source_id` it came from.
3. Datasets under review are listed under `verify:` and are excluded from public builds
   (`--public`) until cleared. Datasets that are not open are listed under `excluded:` so they are
   not added by mistake.
4. Websites whose texts are copyrighted (for example earlychristianwritings.com,
   christian-history.org) are **linked to, never copied**.

## Attribution

A published `core.db` must ship with the credits generated from its `source` table. The app
displays the same list on its Credits page.
