# Data sources & credits

<!-- GENERATED FILE — do not edit. Source of truth: sources/sources.yaml. -->
<!-- Regenerate with `testimonia credits`; CI fails if this file is stale. -->

Testimonia is built entirely on openly licensed data. This page lists every dataset the build
uses, with the credit line its licence requires. A built `core.db` is distributed under
**CC BY-SA 4.0** as a combination of these sources (see [DATA_LICENSE.md](DATA_LICENSE.md)).

**48 sources** · 22 explicitly excluded

## Summary

| Source | Licence | Phase |
|---|---|---|
| Bruhman Translator's Bible | CC-BY-SA-4.0 | 0 |
| CrossWire SWORD modules (public-domain texts only) | PD | 0 |
| eBible.org translations (VPL XML text; USFM for footnotes) | per-translation (PD or CC-BY-SA; filtered at build from translations.csv) | 0 |
| Open Scriptures Hebrew Bible (WLC + morphology) | PD (WLC text) + CC-BY-4.0 (lemmas/morphology) | 0 |
| OpenBible.info cross references | CC-BY-4.0 | 0 |
| STEPBible TAGNT (Translators Amalgamated Greek NT) | CC-BY-4.0 | 0 |
| STEPBible TAHOT (Translators Amalgamated Hebrew OT) | CC-BY-4.0 | 0 |
| STEPBible TBESG / TBESH lexicons and TIPNR proper names | CC-BY-4.0 | 0 |
| STEPBible TVTMS (versification mapping) | CC-BY-4.0 | 0 |
| Testimonia curated tables (this repository, curated/) | CC-BY-SA-4.0 | 0 |
| CCEL ThML — Ante-Nicene Fathers 1–9, Nicene & Post-Nicene Fathers series 1 & 2 | PD (translations 1885–1900) | 1 |
| CCEL ThML — The Works of Flavius Josephus (tr. William Whiston, 1737) | PD (Whiston 1737) | 1 |
| Historical images on the front page (Wikimedia Commons) | PD | 1 |
| HistoricalChristianFaith Commentaries-Database | PD (public-domain dedication) | 1 |
| HistoricalChristianFaith Commentaries-Database — authors after AD 451 | PD (public-domain dedication; some excerpts claimed as fair use) | 1 |
| M. R. James, The Apocryphal New Testament (1924) | PD (US since 2020; author d. 1936) | 1 |
| Mark M. Mattison public-domain translations (gospels.net) | PD (explicit public-domain dedication on each page) | 1 |
| Open Greek and Latin — First1KGreek | CC-BY-SA-4.0 | 1 |
| Perseus canonical-greekLit (incl. Lake's Apostolic Fathers English) | CC-BY-SA-4.0 | 1 |
| Perseus canonical-latinLit + OGL csel-dev (Tertullian, Cyprian, Lactantius, Augustine…) | CC-BY-SA-4.0 | 1 |
| Project Gutenberg (selected PD works) | PD | 1 |
| R. H. Charles, Apocrypha and Pseudepigrapha of the Old Testament (1913) | PD | 1 |
| S. Schechter, Fragments of a Zadokite Work (1910) — Damascus Document, Hebrew + English | PD | 1 |
| Suetonius, Pliny the Younger and Lucian in public-domain translations | PD | 1 |
| Tacitus, Annals — tr. A. J. Church & W. J. Brodribb (1876), Perseus TEI | CC-BY-SA-4.0 | 1 |
| Thomas Aquinas, Catena Aurea (Newman translation, 1841) | PD | 1 |
| Wikipedia page summaries (introductions shown live in the app) | CC-BY-SA-4.0 | 1 |
| Wikisource (selected PD texts) | PD texts (Wikisource contributions CC-BY-SA) | 1 |
| Center for New Testament Restoration — manuscript transcriptions | CC-BY-SA-4.0 | 2 |
| Hebrew Wikisource — Dead Sea Scrolls transcriptions (מגילות מדבר יהודה) | CC-BY-SA-4.0 | 2 |
| INTF NTVMR TEI transcriptions | CC-BY-4.0 (stated in each TEI header) | 2 |
| Miqra according to the Masorah (Aleppo-based Hebrew text) | CC-BY-SA-4.0 | 2 |
| Robinson-Pierpont Byzantine Majority Text (2005/2018) | PD | 2 |
| SBLGNT and apparatus | CC-BY-4.0 | 2 |
| Septuagint, Swete edition (First1KGreek digital text) | CC-BY-SA-4.0 | 2 |
| Wikidata | CC0-1.0 | 2 |
| Wikipedia "List of the Dead Sea Scrolls" (+ per-cave lists, Murabba'at, Nahal Hever, Masada) | CC-BY-SA-4.0 | 2 |
| Wikipedia manuscript lists (NT papyri, uncials, minuscules, LXX codices, DSS) | CC-BY-SA-4.0 | 2 |
| Clear Bible MACULA Greek (SBLGNT & Nestle1904 syntax, glosses, domains, referents) | CC-BY-SA-4.0 | 3 |
| Clear Bible MACULA Hebrew (WLC syntax, SDBH domains, LXX equivalents) | CC-BY-SA-4.0 | 3 |
| UBS open-licensed resources (dictionaries, parallels, HOTTP, routes, realia) | CC-BY-SA-4.0 | 3 |
| HelloAO Free Use Bible API — public-domain commentaries | PD (Henry, JFB, Clarke, Gill, Keil-Delitzsch, Calvin); Tyndale Open Study Notes CC-BY-SA-4.0 | 4 |
| Itiner-e — Roman road network | CC-BY-4.0 | 4 |
| Natural Earth (land, coastlines, rivers and lakes, 1:10m) | PD | 4 |
| OpenBible.info Bible Geocoding Data | CC-BY-4.0 | 4 |
| Pleiades gazetteer of ancient places | CC-BY-3.0 | 4 |
| Theographic Bible Metadata | CC-BY-SA-4.0 | 4 |
| Burrows (ed.), The Dead Sea Scrolls of St. Mark's Monastery vol. 2 fasc. 2 (1951) — 1QS transcription | PD (US, HathiTrust rights 'pdus') | 5 |

## Phase 0: Foundation — texts, words, lexicons, cross references

### Bruhman Translator's Bible

- **Source:** <https://github.com/revjude/BTB>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Bruhman Translator's Bible (BTB), https://github.com/revjude/BTB, CC BY-SA 4.0
- **Used for:** `verse.red_letter`, `heading`, `verse_note`, `quotation`, `topic`, `topic_ref`, `verse_date`, `period`, `lexicon_entry`

### CrossWire SWORD modules (public-domain texts only)

- **Source:** <https://crosswire.org/sword/modules/>
- **Licence:** PD
- **Credit:** Texts via the CrossWire Bible Society SWORD project
- **Used for:** `edition`, `edition_verse`
- **Editions:**
  - `Murdock` — Peshitta NT (Murdock 1852)
  - `Etheridge` — Peshitta NT (Etheridge 1849)
  - `Rotherham` — Rotherham Emphasized
  - `Weymouth` — Weymouth NT

### eBible.org translations (VPL XML text; USFM for footnotes)

- **Source:** <https://ebible.org/Scriptures/translations.csv>
- **Licence:** per-translation (PD or CC-BY-SA; filtered at build from translations.csv)
- **Credit:** Texts from eBible.org — see per-edition credits
- **Used for:** `edition`, `edition_verse`
- **Pinned version:** fetched 2026-11-05, fetched 2026-11-06
- **Editions:**
  - `eng-kjv` — 1769 Blayney text incl. 14 Apocrypha books (PD)
  - `eng-web` (PD)
  - `engbsb` (CC0-1.0)
  - `eng-asv` (PD)
  - `engylt` (PD)
  - `engDBY` (PD)
  - `engwebster` (PD)
  - `englsv` — © 2020 Covenant Press (CC-BY-SA-4.0)
  - `enggnv` (PD)
  - `engtnt` (PD)
  - `engDRA` (PD)
  - `eng-Brenton` (PD)
  - `latVUC` (PD)

### Open Scriptures Hebrew Bible (WLC + morphology)

- **Source:** <https://github.com/openscriptures/morphhb>
- **Licence:** PD (WLC text) + CC-BY-4.0 (lemmas/morphology)
- **Credit:** Open Scriptures Hebrew Bible, CC BY 4.0; Westminster Leningrad Codex (public domain)
- **Used for:** `edition_verse`, `token`
- **Pinned version:** git 3d15126fb1

### OpenBible.info cross references

- **Source:** <https://www.openbible.info/labs/cross-references/>
- **Licence:** CC-BY-4.0
- **Credit:** Cross references from OpenBible.info, CC BY
- **Used for:** `crossref`
- **Pinned version:** fetched 2026-11-05

### STEPBible TAGNT (Translators Amalgamated Greek NT)

- **Source:** <https://github.com/STEPBible/STEPBible-Data>
- **Licence:** CC-BY-4.0
- **Credit:** STEPBible.org / Tyndale House Cambridge, CC BY 4.0
- **Used for:** `token`, `lemma`, `variant_unit`, `variant_reading`, `variant_witness`
- **Pinned version:** git 5de0a47f35

### STEPBible TAHOT (Translators Amalgamated Hebrew OT)

- **Source:** <https://github.com/STEPBible/STEPBible-Data>
- **Licence:** CC-BY-4.0
- **Credit:** STEPBible.org / Tyndale House Cambridge, CC BY 4.0
- **Used for:** `token`, `lemma`, `variant_unit`, `variant_reading`, `variant_witness`

### STEPBible TBESG / TBESH lexicons and TIPNR proper names

- **Source:** <https://github.com/STEPBible/STEPBible-Data>
- **Licence:** CC-BY-4.0
- **Credit:** STEPBible.org / Tyndale House Cambridge, CC BY 4.0
- **Used for:** `lemma`, `lexicon`, `lexicon_entry`, `person`, `place`, `person_ref`, `place_ref`

### STEPBible TVTMS (versification mapping)

- **Source:** <https://github.com/STEPBible/STEPBible-Data>
- **Licence:** CC-BY-4.0
- **Credit:** STEPBible.org / Tyndale House Cambridge, CC BY 4.0
- **Used for:** `versification`, `verse_map`

### Testimonia curated tables (this repository, curated/)

- **Source:** <(this repo)>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Testimonia contributors, CC BY-SA 4.0
- **Used for:** `chronology_system`, `period`, `dating`, `office_holding`, `event`, `canon_list`, `canon_list_item`, `canon_tradition`, `canon_book`, `work`, `person`

## Phase 1: Early Christian & Jewish literature

### CCEL ThML — Ante-Nicene Fathers 1–9, Nicene & Post-Nicene Fathers series 1 & 2

- **Source:** <https://www.ccel.org/>
- **Licence:** PD (translations 1885–1900)
- **Credit:** Philip Schaff (ed.), Ante-Nicene / Nicene and Post-Nicene Fathers; digital text courtesy of the Christian Classics Ethereal Library
- **Used for:** `work`, `work_edition`, `work_section`, `citation`, `person`
- **Pinned version:** fetched 2026-11-06
- **Status:** local builds only — not included in published databases

### CCEL ThML — The Works of Flavius Josephus (tr. William Whiston, 1737)

- **Source:** <https://ccel.org/ccel/josephus/complete>
- **Licence:** PD (Whiston 1737)
- **Credit:** Flavius Josephus, tr. William Whiston (1737); digital text courtesy of the Christian Classics Ethereal Library
- **Used for:** `work`, `work_edition`, `work_section`, `citation`
- **Pinned version:** fetched 2026-11-06
- **Status:** local builds only — not included in published databases

### Historical images on the front page (Wikimedia Commons)

- **Source:** <https://commons.wikimedia.org/>
- **Licence:** PD
- **Credit:** Front-page images from Wikimedia Commons, public domain or CC0 (each credited and linked in its caption)

### HistoricalChristianFaith Commentaries-Database

- **Source:** <https://github.com/HistoricalChristianFaith/Commentaries-Database>
- **Licence:** PD (public-domain dedication)
- **Credit:** Historical Christian Faith Commentaries Database (public domain)
- **Used for:** `commentary`, `commentary_entry`, `person`
- **Pinned version:** git 992bec0d71

### HistoricalChristianFaith Commentaries-Database — authors after AD 451

- **Source:** <https://github.com/HistoricalChristianFaith/Commentaries-Database>
- **Licence:** PD (public-domain dedication; some excerpts claimed as fair use)
- **Credit:** Historical Christian Faith Commentaries Database
- **Used for:** `commentary`, `commentary_entry`, `person`
- **Status:** local builds only — not included in published databases

### M. R. James, The Apocryphal New Testament (1924)

- **Source:** <https://archive.org/details/JAMESApocryphalNewTestament1924>
- **Licence:** PD (US since 2020; author d. 1936)
- **Credit:** M. R. James, The Apocryphal New Testament (Oxford, 1924), public domain
- **Used for:** `work`, `work_edition`, `work_section`

### Mark M. Mattison public-domain translations (gospels.net)

- **Source:** <https://www.gospels.net/>
- **Licence:** PD (explicit public-domain dedication on each page)
- **Credit:** Translations by Mark M. Mattison, public domain
- **Used for:** `work`, `work_edition`, `work_section`

### Open Greek and Latin — First1KGreek

- **Source:** <https://github.com/OpenGreekAndLatin/First1KGreek>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Open Greek and Latin Project, First1KGreek, CC BY-SA 4.0
- **Used for:** `work_edition`, `work_section`, `citation`

### Perseus canonical-greekLit (incl. Lake's Apostolic Fathers English)

- **Source:** <https://github.com/PerseusDL/canonical-greekLit>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Perseus Digital Library, CC BY-SA 4.0
- **Used for:** `work_edition`, `work_section`

### Perseus canonical-latinLit + OGL csel-dev (Tertullian, Cyprian, Lactantius, Augustine…)

- **Source:** <https://github.com/PerseusDL/canonical-latinLit>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Perseus Digital Library / Open Greek and Latin, CC BY-SA 4.0
- **Used for:** `work_edition`, `work_section`

### Project Gutenberg (selected PD works)

- **Source:** <https://www.gutenberg.org/>
- **Licence:** PD
- **Credit:** Project Gutenberg
- **Used for:** `work`, `work_edition`, `work_section`

### R. H. Charles, Apocrypha and Pseudepigrapha of the Old Testament (1913)

- **Source:** <https://archive.org/details/apocryphapseudep01charuoft>
- **Licence:** PD
- **Credit:** R. H. Charles (ed.), APOT (Oxford, 1913), public domain
- **Used for:** `work`, `work_edition`, `work_section`

### S. Schechter, Fragments of a Zadokite Work (1910) — Damascus Document, Hebrew + English

- **Source:** <https://archive.org/details/SchechterFragmentsOfAZadokiteWork1910>
- **Licence:** PD
- **Credit:** S. Schechter, Documents of Jewish Sectaries vol. 1 (Cambridge, 1910), public domain
- **Used for:** `work`, `work_edition`, `work_section`

### Suetonius, Pliny the Younger and Lucian in public-domain translations

- **Source:** <https://www.gutenberg.org/>
- **Licence:** PD
- **Credit:** Suetonius, Lives of the Caesars, tr. A. Thomson rev. T. Forester (1855); Pliny the Younger, Letters, tr. W. Melmoth rev. F. C. T. Bosanquet; Lucian, tr. H. W. and F. G. Fowler (Oxford, 1905) — public domain
- **Used for:** `work`, `work_edition`, `work_section`
- **Pinned version:** fetched 2026-11-06

### Tacitus, Annals — tr. A. J. Church & W. J. Brodribb (1876), Perseus TEI

- **Source:** <https://github.com/PerseusDL/canonical-latinLit>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Tacitus, Annals, tr. A. J. Church & W. J. Brodribb (1876); TEI by the Perseus Digital Library, CC BY-SA 4.0
- **Used for:** `work`, `work_edition`, `work_section`
- **Pinned version:** fetched 2026-11-06

### Thomas Aquinas, Catena Aurea (Newman translation, 1841)

- **Source:** <https://www.ccel.org/ccel/aquinas/catena1.xml>
- **Licence:** PD
- **Credit:** Catena Aurea, trans. J.H. Newman (1841), public domain
- **Used for:** `commentary`, `commentary_entry`
- **Pinned version:** fetched 2026-11-06
- **Status:** local builds only — not included in published databases

### Wikipedia page summaries (introductions shown live in the app)

- **Source:** <https://en.wikipedia.org/api/rest_v1/>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Introductions to authors, works and events from Wikipedia, CC BY-SA 4.0 (credited on each card)

### Wikisource (selected PD texts)

- **Source:** <https://en.wikisource.org/>
- **Licence:** PD texts (Wikisource contributions CC-BY-SA) *(ShareAlike)*
- **Credit:** Wikisource contributors
- **Used for:** `work_section`

## Phase 2: Textual criticism, manuscripts & Dead Sea Scrolls

### Center for New Testament Restoration — manuscript transcriptions

- **Source:** <https://github.com/Center-for-New-Testament-Restoration/transcriptions>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Alan Bunning, Center for New Testament Restoration (CNTR), Electronic Transcriptions, https://github.com/Center-for-New-Testament-Restoration/transcriptions, CC BY-SA 4.0
- **Used for:** `edition (kind=manuscript)`, `edition_verse`
- **Pinned version:** git 4e743a41a4

### Hebrew Wikisource — Dead Sea Scrolls transcriptions (מגילות מדבר יהודה)

- **Source:** <https://he.wikisource.org/wiki/מגילות_מדבר_יהודה>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Hebrew Wikisource contributors, CC BY-SA 4.0
- **Used for:** `edition (kind=manuscript)`, `edition_verse`, `work_section`

### INTF NTVMR TEI transcriptions

- **Source:** <https://ntvmr.uni-muenster.de/>
- **Licence:** CC-BY-4.0 (stated in each TEI header)
- **Credit:** Institut für Neutestamentliche Textforschung, Münster, CC BY 4.0
- **Used for:** `edition (kind=manuscript)`, `edition_verse`

### Miqra according to the Masorah (Aleppo-based Hebrew text)

- **Source:** <https://github.com/bdenckla/MAM-basics>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Miqra according to the Masorah (MAM), via Hebrew Wikisource, CC BY-SA 4.0
- **Used for:** `edition`, `edition_verse`

### Robinson-Pierpont Byzantine Majority Text (2005/2018)

- **Source:** <https://github.com/byztxt/byzantine-majority-text>
- **Licence:** PD
- **Credit:** Robinson & Pierpont, The New Testament in the Original Greek: Byzantine Textform (public domain)
- **Used for:** `edition`, `edition_verse`, `variant_reading`

### SBLGNT and apparatus

- **Source:** <https://github.com/Faithlife/SBLGNT>
- **Licence:** CC-BY-4.0
- **Credit:** SBL Greek New Testament, Society of Biblical Literature & Logos/Faithlife, CC BY 4.0
- **Used for:** `edition`, `edition_verse`, `variant_unit`, `variant_reading`, `variant_witness`

### Septuagint, Swete edition (First1KGreek digital text)

- **Source:** <https://github.com/OpenGreekAndLatin/First1KGreek/tree/master/data/tlg0527>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** The Old Testament in Greek according to the Septuagint, ed. Henry Barclay Swete (Cambridge, 1901–1909; public domain); digital text from the First Thousand Years of Greek project (Open Greek and Latin, University of Leipzig; corrected and encoded by Digital Divide Data), https://github.com/OpenGreekAndLatin/First1KGreek, CC BY-SA 4.0
- **Used for:** `edition`, `edition_verse`
- **Pinned version:** git ed91552c52

### Wikidata

- **Source:** <https://query.wikidata.org/>
- **Licence:** CC0-1.0
- **Credit:** Wikidata (CC0)
- **Used for:** `external_id`, `person`, `dating`, `event`, `manuscript`, `place`
- **Pinned version:** fetched 2026-11-06

### Wikipedia "List of the Dead Sea Scrolls" (+ per-cave lists, Murabba'at, Nahal Hever, Masada)

- **Source:** <https://en.wikipedia.org/wiki/List_of_the_Dead_Sea_Scrolls>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Wikipedia contributors, CC BY-SA 4.0
- **Used for:** `manuscript`, `manuscript_coverage`, `dating`, `external_id`
- **Pinned version:** fetched 2026-11-06

### Wikipedia manuscript lists (NT papyri, uncials, minuscules, LXX codices, DSS)

- **Source:** <https://en.wikipedia.org/wiki/List_of_New_Testament_papyri>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Wikipedia contributors, CC BY-SA 4.0
- **Used for:** `manuscript`, `manuscript_coverage`, `dating`, `external_id`
- **Pinned version:** fetched 2026-11-06

## Phase 3: Linguistic data — syntax, semantic domains, parallels

### Clear Bible MACULA Greek (SBLGNT & Nestle1904 syntax, glosses, domains, referents)

- **Source:** <https://github.com/Clear-Bible/macula-greek>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** MACULA Greek Linguistic Datasets, available at https://github.com/Clear-Bible/macula-greek/ (Biblica / Clear Bible, CC BY 4.0); semantic domains from the United Bible Societies' Semantic Dictionary of Biblical Greek (MARBLE), based on Louw & Nida, Greek-English Lexicon of the New Testament Based on Semantic Domains (UBS 1988)
- **Used for:** `token`, `lemma`, `semantic_domain`, `lemma_sense`
- **Pinned version:** fetched 2026-11-06

### Clear Bible MACULA Hebrew (WLC syntax, SDBH domains, LXX equivalents)

- **Source:** <https://github.com/Clear-Bible/macula-hebrew>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** MACULA Hebrew Linguistic Datasets, available at https://github.com/Clear-Bible/macula-hebrew/ (Biblica / Clear Bible, CC BY 4.0); semantic domains from the Semantic Dictionary of Biblical Hebrew, ed. Reinier de Blois, © 2000–2021 United Bible Societies
- **Used for:** `token`, `lemma`, `semantic_domain`, `lemma_sense`, `entity_link`
- **Pinned version:** fetched 2026-11-06

### UBS open-licensed resources (dictionaries, parallels, HOTTP, routes, realia)

- **Source:** <https://github.com/ubsicap/ubs-open-license>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** United Bible Societies, CC BY-SA 4.0 (UBS Parallel Passage Database © 2023 United Bible Societies)
- **Used for:** `lexicon`, `lexicon_entry`, `semantic_domain`, `lemma_sense`, `parallel_group`, `parallel_member`, `quotation`, `variant_unit`, `variant_reading`, `geo_feature`
- **Pinned version:** git a15a96cfaa

## Phase 4: Context — people, places, events, maps, commentaries

### HelloAO Free Use Bible API — public-domain commentaries

- **Source:** <https://bible.helloao.org/>
- **Licence:** PD (Henry, JFB, Clarke, Gill, Keil-Delitzsch, Calvin); Tyndale Open Study Notes CC-BY-SA-4.0
- **Credit:** Commentaries via the HelloAO Free Use Bible API
- **Used for:** `commentary`, `commentary_entry`

### Itiner-e — Roman road network

- **Source:** <https://doi.org/10.5281/zenodo.17122148>
- **Licence:** CC-BY-4.0
- **Credit:** Itiner-e, CC BY 4.0
- **Used for:** `geo_feature`

### Natural Earth (land, coastlines, rivers and lakes, 1:10m)

- **Source:** <https://www.naturalearthdata.com/>
- **Licence:** PD
- **Credit:** Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com (public domain)
- **Pinned version:** fetched 2026-11-06

### OpenBible.info Bible Geocoding Data

- **Source:** <https://github.com/openbibleinfo/Bible-Geocoding-Data>
- **Licence:** CC-BY-4.0
- **Credit:** Bible geocoding data from OpenBible.info, CC BY 4.0
- **Used for:** `place`, `place_ref`, `external_id`
- **Pinned version:** fetched 2026-11-06

### Pleiades gazetteer of ancient places

- **Source:** <https://pleiades.stoa.org/>
- **Licence:** CC-BY-3.0
- **Credit:** Pleiades, CC BY 3.0
- **Used for:** `external_id`

### Theographic Bible Metadata

- **Source:** <https://github.com/robertrouse/theographic-bible-metadata>
- **Licence:** CC-BY-SA-4.0 *(ShareAlike)*
- **Credit:** Theographic Bible Metadata by Robert Rouse, CC BY-SA 4.0 (crediting its sources: STEPBible TIPNR, OpenBible.info, Pleiades, Easton's Bible Dictionary, F. N. Jones's chronology)
- **Used for:** `person`, `person_relation`, `person_ref`, `event`, `event_participant`, `event_ref`, `dating`, `geo_feature`, `external_id`
- **Pinned version:** fetched 2026-11-06

## Phase 5: Optional / future

### Burrows (ed.), The Dead Sea Scrolls of St. Mark's Monastery vol. 2 fasc. 2 (1951) — 1QS transcription

- **Source:** <https://babel.hathitrust.org/cgi/pt?id=mdp.39015090351985>
- **Licence:** PD (US, HathiTrust rights 'pdus')
- **Credit:** M. Burrows (ed.), ASOR, 1951 — public domain in the US
- **Used for:** `edition (kind=manuscript)`, `work_section`

## Under verification

These are not used in public builds until cleared:

- `btb-lxx`
- `ccel-permission`
- `brownlee-1951`
- `burrows-1950-v1`
- `dare-tiles`

## Not used (not openly licensed)

Listed so they are not added by mistake. Where useful, the app links to them instead.

| Dataset | Reason |
|---|---|
| `biblindex` | no data licence; OAuth-gated |
| `ccat-catss` | Rahlfs LXX / CATSS: signed user agreement, non-commercial, no redistribution |
| `christian-history-org` | © Paul Pavao — link only |
| `cntr-website` | all rights reserved (transcriptions repo is fine) |
| `dss-modern-translations` | Vermes, Wise/Abegg/Cook, García Martínez, Burrows 1955/1958 (renewed), Gaster 1956 (renewed), Dupont-Sommer — copyrighted |
| `dt-ucph-sp` | Samaritan Pentateuch data, CC BY-NC |
| `earlychristianwritings` | © Peter Kirby — link only |
| `etcbc-bhsa` | CC BY-NC |
| `etcbc-dss` | CC BY-NC (re-checked 2026-11-05) |
| `etcbc-peshitta` | CC BY-NC |
| `intf-liste` | no licence stated for manuscript metadata |
| `jubilee2000` | non-commercial only |
| `lamsa` | © HarperCollins |
| `leb` | non-commercial only |
| `leon-levy-dss` | © Israel Antiquities Authority — deep links only |
| `lxx-rahlfs-eliranwong` | CC BY-NC-SA (derived from CCAT) |
| `nag-hammadi-library-in-english` | © Robinson et al. — link only |
| `nets` | © Oxford UP |
| `newadvent` | © New Advent LLC |
| `sinaiticus-project` | CC BY-NC-SA 3.0 |
| `sqe-data` | Scripta Qumranica Electronica database: no data licence (code is MIT); third-party 'MIT' dumps have doubtful chain of rights |
| `thgnt` | Tyndale House GNT standalone text/apparatus not openly licensed (readings available via TAGNT) |
