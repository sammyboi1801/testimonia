# Testimonia

**An open-source Bible study application for the Old Testament, the New Testament, the early
church, the manuscripts and the chronology that connects them — built entirely on open data.**

*Testimonia* were the collections of scriptural "witnesses" compiled by the earliest
Christians. This project gathers every kind of witness to the biblical text into one place:
the Hebrew and Greek texts and their ancient translations, the manuscripts that carry them
(from the Dead Sea Scrolls and the early papyri to the great codices), and the writers of the
first centuries who quoted, explained and debated them.

> **Status: pre-alpha.** The data model is defined; data ingestion and the user interface are
> under construction. See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

## Focus

- **Old and New Testament** in the original languages, with the Septuagint, Vulgate and
  historic English translations side by side.
- **The pre-Nicene church** (to AD 325) as the default lens, with the major later fathers
  (Athanasius, the Cappadocians, Chrysostom, Jerome, Augustine) and Aquinas available.
- **Textual transmission**: variants, manuscripts, the Dead Sea Scrolls, and a *witness
  timeline* showing who attests each reading, and when.
- **Chronology** as a first-class feature, with competing chronologies (Ussher, Thiele, modern
  scholarly datings) shown side by side and their uncertainty made explicit.

## Planned features

| Area | Highlights |
|---|---|
| Reader | linked parallel panes · interlinear · Hebrew/Greek with morphology · red letters |
| Passage guide | variants · manuscripts containing the verse · church fathers citing it · cross references · parallels · OT in the NT · commentaries · people & places · scholarship |
| Word study | lexicons (BDB, Abbott-Smith, LSJ, UBS) · semantic domains · every occurrence · Hebrew → Septuagint equivalents |
| Library | apostolic fathers, apologists, church fathers, NT apocrypha, OT pseudepigrapha, Qumran texts — with every scripture citation linked |
| Manuscripts | NT papyri & codices, LXX codices, Masoretic codices, Dead Sea Scrolls — dates, contents, transcriptions |
| Context | timeline · atlas · kings & rulers · canon-history comparison · people/places/events pages |
| Personal | notes (Obsidian-compatible markdown) · your own translation · highlights · reading plans |

## Data

Testimonia only uses **openly licensed data** (public domain, CC0, CC BY, CC BY-SA). The full
list of datasets, their licences and the tables they feed is in
[`sources/sources.yaml`](sources/sources.yaml). Licensing rules are in
[`DATA_LICENSE.md`](DATA_LICENSE.md).

Major sources include the [Bruhman Translator's Bible](https://github.com/revjude/BTB),
[STEPBible data](https://github.com/STEPBible/STEPBible-Data) (Tyndale House),
[Open Scriptures Hebrew Bible](https://github.com/openscriptures/morphhb),
[SBLGNT](https://github.com/Faithlife/SBLGNT), [MACULA](https://github.com/Clear-Bible),
the [UBS open-licensed resources](https://github.com/ubsicap/ubs-open-license),
[CNTR](https://github.com/Center-for-New-Testament-Restoration),
[Open Greek and Latin](https://github.com/OpenGreekAndLatin),
[Theographic](https://github.com/robertrouse/theographic-bible-metadata),
[OpenBible.info](https://www.openbible.info/), [Pleiades](https://pleiades.stoa.org/) and
[Wikidata](https://www.wikidata.org/).

## Development

```bash
python -m venv .venv && .venv/Scripts/activate      # Windows (use bin/activate elsewhere)
pip install -e ".[dev]"
pytest                                              # tests
ruff check . && ruff format --check .               # lint + format
mypy testimonia                                     # types
```

Data is kept outside the repository, in `~/TestimoniaData` by default (override with
`TESTIMONIA_DATA`). See [`testimonia/config.py`](testimonia/config.py) for all settings.

## Licence

Code: [MIT](LICENSE). Data: see [DATA_LICENSE.md](DATA_LICENSE.md) — a built database is CC BY-SA 4.0.
