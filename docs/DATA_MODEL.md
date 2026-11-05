# Testimonia — Data Model & Storage

Testimonia is an open-source Bible study application focused on the **Old Testament, the New
Testament, the pre-Nicene church, textual transmission and chronology**. This document describes
how data is stored: the files on disk, the SQLite databases, every table group, and which open
source feeds which table.

- Schema files: [`schema/core.sql`](../schema/core.sql), [`schema/user.sql`](../schema/user.sql)
- Source manifest: [`sources/sources.yaml`](../sources/sources.yaml)

---

## 1. Principles

1. **Open data only.** Every bundled dataset is PD, CC0, CC BY or CC BY-SA. Anything else is
   link-only (see `excluded:` in `sources.yaml`). Because several sources are ShareAlike, a
   published `core.db` is licensed **CC BY-SA 4.0**; the code is licensed separately (e.g. MIT).
2. **Provenance on every row.** Each data row carries `source_id`. Credits, licence checks and
   "public build" filtering are generated from it.
3. **The core database is a build artifact.** It is generated from pinned downloads by the
   ingest pipeline and can be deleted and rebuilt at any time. Nothing a user writes lives in it.
4. **Everything joins on a few universal keys**: verse (`vkey`), lemma, person, place, work,
   manuscript, event. This is what makes a verse page able to show variants, manuscripts,
   church-father citations, parallels, places and dates together.
5. **Chronology is first-class.** Anything can be dated, under several competing chronology
   systems at once, with explicit uncertainty.
6. **Native text is preserved.** Each text keeps its own versification; mapping to the hub
   scheme is data (`verse_map`), not a destructive transformation.

---

## 2. Files on disk

```
Testimonia/                      ← git repository (code + schema + curated data; no bulk data)
├── schema/
│   ├── core.sql                 ← core database schema (derived; versioned, rebuilt on change)
│   ├── ai.sql                   ← optional AI database: chunks, embeddings, AI cache, proposals
│   ├── user_migrations/         ← user database: 0001_initial.sql, 0002_ai_conversations.sql, …
│   └── modules/                 ← add-on feature schemas (see modules/README.md)
├── sources/
│   ├── sources.yaml             ← every dataset: URL, licence, attribution, tables fed, phase
│   └── queries/*.rq             ← Wikidata SPARQL queries used by the build
├── curated/                     ← hand-encoded open data (CSV/YAML, CC BY-SA 4.0, reviewed in PRs)
│   ├── chronology_systems.csv
│   ├── periods.csv              (biblical eras, Second Temple, Roman, church eras)
│   ├── kings_israel_judah.csv   (with Thiele / Galil / Albright regnal dates)
│   ├── ane_rulers.csv           (Assyria, Babylon, Persia, Ptolemies, Seleucids, Hasmoneans, Herodians)
│   ├── roman_emperors.csv
│   ├── councils.csv, persecutions.csv, church_events.csv
│   ├── book_dates.csv           (composition: traditional vs critical, per book)
│   ├── authors.csv              (fathers & ancient authors: QID, era, dates, place)
│   ├── works.csv                (the Library catalogue: category, date window, ECW link)
│   ├── canon_lists.csv, canon_list_items.csv, canon_traditions.csv
│   └── book_meta.csv            (Hebrew/Greek/Latin names, genres)
├── testimonia/                  ← Python package
│   ├── books.py, refs.py        ← book table, reference parser, vkey helpers
│   ├── uri.py                   ← universal URIs (verse:John.1.18, person:irenaeus, …)
│   ├── db.py, config.py
│   ├── fetch.py                 ← downloads sources into raw/ (pinned versions, sha256)
│   ├── build.py                 ← runs ingest modules in dependency order, builds FTS, validates
│   └── ingest/<source>.py       ← one module per source id in sources.yaml
├── web/                         ← front-end
└── docs/

TestimoniaData/                  ← data directory (outside the repo; C:\Users\Sam\TestimoniaData)
├── raw/<source_id>/<version>/   ← untouched downloads (git clones, zips, API caches)
├── build/core.db                ← generated (≈3–6 GB with FTS)
├── build/ai.db                  ← optional, generated (embeddings: size depends on model)
└── user/
    ├── user.db                  ← highlights, plans, translations, settings, API cache
    └── notes/                   ← your markdown notes (open the folder as an Obsidian vault)
```

**Why curated data is CSV in the repo:** chronologies, canon lists, regnal dates and the work
catalogue are scholarly judgements that need review, citations and history. CSV in git gives
diffs, pull requests and blame. Each curated row has a `citation` column pointing to its primary
source or the Wikipedia table it was encoded from.

---

## 3. Build pipeline

```
sources.yaml ──fetch──► raw/ ──ingest/<source>.py──► core.db ──index──► FTS5 ──validate──► done
                         ▲                              ▲
                         └── pinned version + sha256    └── curated/*.csv loaded first
```

Order (dependencies first):

1. `curated` + `books` → `source`, `book`, `canon_*`, `versification`, `chronology_system`, `period`
2. `stepbible-tvtms` → `verse_map`; then `verse` (hub verse list)
3. Texts: `ebible`, `crosswire-pd`, `oshb`, `stepbible-tagnt/tahot`, … → `edition`, `edition_verse`, `token`, `lemma`
4. Study layers: `btb`, `openbible-xref`, `ubs-open`, `macula-*` → headings, notes, crossrefs, parallels, syntax
5. Literature: `ccel-schaff`, `first1kgreek`, `perseus-*`, `mattison`, `james-1924`, `charles-apot`, `hcf-commentaries` → `work*`, `citation`, `commentary*`
6. Textual criticism: `sblgnt-apparatus`, `byzantine-rp`, `cntr`, `intf-transcriptions`, `wikipedia-manuscripts`, `mam-aleppo`, `lxx-swete` → `variant_*`, `manuscript*`
7. Context: `theographic`, `openbible-geo`, `pleiades`, `wikidata`, `itinere` → people, places, events, `dating`
8. Denormalise (e.g. `citation.year` from work dates), compute `lemma.frequency`, fill FTS, run validation queries

Each ingest module is **idempotent**: it deletes rows with its own `source_id` and re-inserts.
A `--public` build flag skips sources not cleared for redistribution (e.g. CCEL until permission).

---

## 4. Core conventions

### 4.1 Verse keys
```
vkey = book_order × 1,000,000 + chapter × 1,000 + verse        John 1:18 → 43,001,018
```
- Integer, sortable; a range query is `BETWEEN start AND end`; chapter-level = verse 0.
- `verse.osis` holds the readable id (`John.1.18`), matching BTB, STEPBible, OpenBible, CCEL.
- Book order is the hub order in `book.ord` (Protestant OT → NT → deuterocanon → pseudepigrapha).
  Other traditions' orders live in `canon_book`.

### 4.2 Years
Astronomical integers: **1 AD = 1, 1 BC = 0, 2 BC = −1**. So 1446 BC = −1445, and arithmetic
across the BC/AD boundary is correct. The UI formats them. Source wording is kept in `label`.

### 4.3 Identifiers
Readable slugs: `irenaeus`, `irenaeus.haer`, `irenaeus.haer@anf`, `GA:P66`, `DSS:1QIsaa`,
`council-of-nicaea`, `hezekiah@king-judah`. External identifiers (Wikidata, Pleiades, TLG, CPG,
Gregory-Aland, Trismegistos, DJD) go in `external_id`.

---

## 5. Versification (the hardest correctness problem)

The hub scheme is **English (KJV + Apocrypha)**. Other schemes: `heb` (Masoretic), `lxx`, `vul`, `nrsv`.

| Example | Native | Hub |
|---|---|---|
| Psalm 23 in the LXX / Vulgate | `Ps.22.1` (lxx) | `Ps.23.1` |
| Malachi in Hebrew | `Mal.3.19` (heb) | `Mal.4.1` |
| Joel in Hebrew | `Joel.4.1` (heb) | `Joel.3.1` |
| Psalm titles in Hebrew | `Ps.51.1–2` (heb) | `Ps.51.0` + `Ps.51.1` |
| 3 John | `3John.1.15` (nrsv) | `3John.1.14` (part) |

- `verse_map(versification_id, native_ref, vkey, relation)` is loaded from STEPBible **TVTMS**.
- `edition.versification_id` says which scheme a text uses; ingest converts to `vkey` and keeps
  `edition_verse.native_ref` when it differs, so the UI can show "Ps 22:1 (LXX numbering)".
- Greek Esther / Greek Daniel additions are separate DC books (`AddEsth`, `PrAzar`, `Sus`, `Bel`)
  in the hub; editions that print them inline (Douay, Vulgate) map onto those books.

---

## 6. Table groups

### 6.1 Provenance — `source`, `meta`, `external_id`
One `source` row per dataset in `sources.yaml` (licence, attribution, version, sha256).

### 6.2 Canon & books — `book`, `canon_tradition`, `canon_book`, `versification`, `verse`, `verse_map`, `heading`
- `book` carries Hebrew/Greek/Latin names and genre, so the OT can be browsed as **Tanakh**
  (Torah / Nevi'im / Ketuvim via `canon_book`) as well as in Christian orders.
- `heading` stores pericopes (BTB), section headings (BSB), and Hebrew **parashot / petuchot /
  setumot** — the oldest paragraphing we have, attested already in Qumran scrolls.

### 6.3 Texts — `edition`, `edition_verse`, `edition_note`
One model for translations (KJV, BSB, WEB, Brenton, Douay…), original-language editions
(WLC, SBLGNT, Byzantine, Swete LXX, Aleppo/MAM), the Vulgate, Peshitta translations and
**manuscript transcriptions** (`kind='manuscript'`, `manuscript_id` set: P66, 01, …).
A parallel view is just `SELECT … FROM edition_verse WHERE vkey BETWEEN ? AND ? AND edition_id IN (…)`.

### 6.4 Words — `lemma`, `lexicon`, `lexicon_entry`, `semantic_domain`, `lemma_sense`, `morph_code`, `token`, `syntax_node`, `alignment`
- `token`: one row per word for TAGNT (NT), TAHOT/OSHB (OT), MACULA, Swete LXX. Hebrew prefixes
  are kept as morpheme parts (`parts` JSON) so search works by word and by morpheme.
- NT tokens carry `editions` (which printed editions contain the word) — the basis of the
  "which editions differ here" view.
- OT tokens carry `lxx_equiv` (MACULA Hebrew's Greek equivalent), linking a Hebrew word to how
  the Septuagint translated it: a key Old-Testament study tool.
- `lexicon_entry` holds full articles (BDB, Abbott-Smith, LSJ, UBS dictionaries, TBESG/TBESH…).
- `syntax_node` holds MACULA syntax trees for diagrams and clause search.

### 6.5 Textual criticism — `variant_unit`, `variant_reading`, `variant_witness`, `manuscript`, `manuscript_coverage`
A **variant unit** is a place where witnesses disagree; each **reading** lists its **witnesses**,
which can be editions, manuscripts, church fathers or ancient versions:

```
variant_unit  John.1.18  "μονογενὴς θεός / ὁ μονογενὴς υἱός"   source=stepbible-tagnt
 ├─ reading 1  μονογενὴς θεός   "only-begotten God"   witnesses: NA28, SBL, WH, Treg, GA:P66, GA:P75, GA:01, irenaeus…
 └─ reading 2  ὁ μονογενὴς υἱός "the only-begotten Son" witnesses: TR, Byz, GA:02, …
```

OT example: `Deut.32.8` — MT "sons of Israel" vs. Qumran/LXX "sons of God" (HOTTP + DSS witness).

`manuscript` covers **all traditions**: NT papyri/majuscules/minuscules (Gregory-Aland),
LXX codices, Masoretic codices (Leningrad, Aleppo), **Dead Sea Scrolls**, and versional
manuscripts. `manuscript_coverage` stores which verses each contains, so "which manuscripts
before 300 AD contain this verse" is one range query.

### 6.6 People, places, events — `person`, `person_relation`, `office_holding`, `person_ref`, `place`, `place_ref`, `geo_feature`, `event`, `event_participant`, `event_ref`
One `person` table for biblical figures, church fathers, rulers, heretics, rabbis and scholars
(`kind`), so a timeline can show Hezekiah, Sennacherib, Isaiah and the Siloam tunnel together,
or Irenaeus, Marcus Aurelius and the martyrs of Lyon together. `office_holding` models
successions: kings of Israel/Judah, high priests, Roman emperors, bishops of Rome/Alexandria/Antioch.

### 6.7 Chronology — `chronology_system`, `dating`, `verse_date`, `period`, `verse_period`
Dates are never a single column on an entity. They are rows in `dating`, each under a
**chronology system** and with an explicit **kind**:

| `date_kind` | meaning | example |
|---|---|---|
| `point` | happened at one time | Fall of Jerusalem, −586 (587/586 BC) |
| `span` | lasted from start to end | Hezekiah's reign, −715 → −686 (Thiele) |
| `window` | happened once, sometime in the range | Didache composed, 50 → 120 |

Competing systems coexist:

```
entity: event 'exodus'
  ussher       point  −1490   (1491 BC)
  traditional  point  −1445   (1446 BC, 1 Kgs 6:1 early date)
  scholarly    window −1290 → −1200   (13th-century late date)

entity: office_holding 'hezekiah@king-judah'   aspect='reign'
  thiele   span −715 → −686  (co-regency from −728)
  galil    span −726 → −697
  albright span −714 → −685

entity: manuscript 'GA:P66'        aspect='when'   system='scholarly'  window 175 → 225  basis='palaeography'
entity: work 'irenaeus.haer'       aspect='composition'                window 174 → 189
entity: book 'Dan'                 aspect='composition'  traditional: point −535 ; scholarly: window −167 → −164
```

`verse_date` gives each verse's **narrative time** (Ussher via Theographic; BTB's era/date/
chronological order), so a chronological reading order or a "what was happening when" panel
is a simple join. The `timeline` view unions every dated thing for the timeline UI; the user
picks which chronology system to display.

### 6.8 Ancient literature — `work`, `work_edition`, `work_section`, `citation`
- `work` is the Library catalogue: church fathers (all eras, pre-Nicene default), apostolic
  fathers, NT apocrypha, OT pseudepigrapha, Qumran texts, gnostic, Jewish, pagan, liturgical,
  martyrologies, canon lists. Each has a category, era, date window and optional ECW link.
- `work_edition` holds each text of a work — English translation, Greek/Latin original — and
  `work_section.cite` uses the standard citation scheme, so original and translation align
  section by section (e.g. Lake's Apostolic Fathers ↔ First1KGreek Greek).
- `citation` is the index of **scripture cited by ancient literature**, built from CCEL
  `scripRef` tags, First1KGreek `<bibl>` tags and curated indexes. It records the work, section,
  author, date and — where available — the **wording the author used**, which is evidence for
  the history of the text.

### 6.9 Commentary — `commentary`, `commentary_entry`
Patristic excerpts by verse (Commentaries-Database: fathers → Aquinas → reformers, with years),
the *Catena Aurea*, and classic commentaries (Henry, Gill, Clarke, JFB, Keil-Delitzsch, Calvin).
`commentary.year`/`era` drive the pre-Nicene filter.

### 6.10 Intertextuality — `crossref`, `parallel_group`, `parallel_member`, `quotation`, `verse_note`
- `crossref`: OpenBible (with votes) and TSK.
- `parallel_group`: synoptic gospels (with Aland numbers), **Samuel–Kings ∥ Chronicles**,
  Ps 18 ∥ 2 Sam 22, Isa 36–39 ∥ 2 Kgs 18–20, and other OT parallels; UBS word-level match data.
- `quotation`: NT use of the OT (and OT-internal), with `via` = LXX / MT form.

### 6.11 Topics & canon history — `topic`, `topic_ref`, `canon_list`, `canon_list_item`
Canon lists (Muratorian fragment, Melito, Origen, Eusebius *HE* 3.25, Athanasius *Festal Letter
39*, Laodicea, Carthage, Jerome…) with item status `accepted / disputed / rejected / spurious`.
Items can be books **or works** (Hermas, Barnabas, 1 Enoch, Wisdom), and each list links to its
primary text in the Library.

### 6.12 Scholarship — `bibliography`, `bibliography_link`
Curated references (including public-domain critical editions on archive.org: Tischendorf,
Swete, Westcott-Hort). Live results from OpenAlex/Crossref/DOAJ are cached in `user.db`.

### 6.13 Search — FTS5 tables
`fts_verse`, `fts_work`, `fts_comment`, `fts_lexicon`, `fts_entity` (contentless, diacritics-
insensitive so `λογος` finds `λόγος`). Queries join back to the real tables on the stored keys.

---

## 7. The Old Testament layer

| Need | Tables | Sources |
|---|---|---|
| Hebrew text, morphology, Qere/Ketiv | `edition_verse`, `token` | OSHB/WLC, TAHOT |
| Aleppo-based text | `edition_verse` | MAM |
| Septuagint (Greek + English) | `edition_verse`, `token` | Swete (verify), Brenton |
| Hebrew ↔ Greek correspondence | `token.lxx_equiv`, `alignment` | MACULA Hebrew |
| Vulgate, Douay-Rheims | `edition_verse` | eBible |
| OT text criticism | `variant_*` | HOTTP (UBS), TAHOT variant codes |
| Dead Sea Scrolls | `manuscript`, `manuscript_coverage`, `work` (sectarian texts) | see §8 |
| Kings, prophets, high priests | `person`, `office_holding`, `dating` | curated + Theographic |
| ANE rulers & events | `person`, `event`, `dating` | curated + Wikidata |
| Parallels (Sam–Kgs ∥ Chr) | `parallel_*` | UBS parallels + curated |
| Paragraphing (petuchot/setumot) | `heading` | OSHB/MAM |
| Pseudepigrapha (1 Enoch, Jubilees…) | `work*` | Charles APOT (1913) |
| Jewish interpretation (Josephus, Philo) | `work*` | Whiston, Yonge (PD) |

---

## 8. Dead Sea Scrolls

Modelled as:
- **Scrolls → `manuscript`** (`id='DSS:1QIsaa'`, collection `DSS`, cave/site in `discovered`,
  date window, script, DJD volume in `external_id`), with `manuscript_coverage` listing the
  biblical verses each scroll preserves.
- **Biblical scroll text → `edition`** (`kind='manuscript'`) *only if an open transcription exists*.
- **Scroll readings → `variant_witness`** (`witness_type='manuscript'`, e.g. 4QDeutʲ at Deut 32:8).
- **Non-biblical scrolls → `work`** (`category='qumran'`: Community Rule, Damascus Document,
  War Scroll, pesharim, Hodayot, Temple Scroll…) with public-domain translations where they exist
  (e.g. Schechter's 1910 *Fragments of a Zadokite Work* / Charles 1913 for the Damascus Document).

What open data allows (researched 2026-11-05):

| Feature | Open source | Coverage |
|---|---|---|
| Scroll catalogue + "attested at Qumran" per verse | Wikipedia *List of the Dead Sea Scrolls* (CC BY-SA) | ~436 manuscripts; ~200 biblical scrolls with verse contents; palaeographic dates (→ `manuscript.script` + dating window) |
| DSS readings in OT text criticism | UBS HOTTP (CC BY-SA); TAHOT (CC BY) | 15 HOTTP entries cite Qumran explicitly (1QIsᵃ, 4QSam…); famous cases (Deut 32:8, 32:43, Ps 22:17, Ps 145:13 nun line, Isa 53:11) covered |
| Scroll text | Hebrew Wikisource (CC BY-SA) community transcriptions | 11QPsᵃ, 1QpHab, 1QS, 1QM, 11QT, MMT, 3Q15, CD and a few others |
| Sectarian texts in English | Schechter 1910 / Charles 1913 (PD) | Damascus Document only |
| Images, other translations | Leon Levy Library, modern editions | **link only** (copyrighted) |

Not openly available anywhere: the full text of 1QIsaᵃ, 4QSamᵃ or the 4QDeut scrolls, and any
English translation of the major sectarian scrolls other than the Damascus Document. The ETCBC
`dss` dataset remains CC BY-NC and the SQE database has no data licence, so both are excluded.
These gaps are good candidates for future community or AI-assisted work (with review), which
the extensibility layer (§13) is designed to hold.

---

## 9. User database (`user.db`) and notes

| Table | Purpose |
|---|---|
| `note` | index of markdown notes in `notes/`, each anchored to any URI (verse range, work section, person, manuscript…) |
| `my_translation` | your own translation verse by verse (replaces BTB pericope note lines) |
| `highlight`, `tagging`, `collection`, `collection_item` | highlights, tags on anything, passage lists / study sets / outlines |
| `reading_plan`, `reading_progress` | canonical, chronological, fathers' reading plans |
| `history`, `workspace`, `setting` | navigation, saved layouts, preferences |
| `api_cache` | cached OpenAlex/Crossref/DOAJ/Internet Archive responses |
| `ai_conversation`, `ai_message`, `ai_feedback` | AI study-assistant chats, with retrieved context and citations as URIs (migration 0002) |

Every user table references core data by **URI**, never by core rowid, so rebuilding core.db
never breaks user data. User rows carry a uuid, `created_at`/`updated_at` and a `deleted`
tombstone, so multi-device sync can be added later (last-write-wins per row) without a migration.
User schema changes are numbered migrations (`schema/user_migrations/NNNN_*.sql`), applied in
order in their own transactions; an older app refuses to open a newer user.db.

Notes are plain markdown with YAML front-matter, so the `notes/` folder can be opened directly
in Obsidian. The app re-indexes files whose mtime changed.

---

## 10. Licensing & the public build

- Code: permissive licence (MIT suggested).
- Published `core.db`: CC BY-SA 4.0, with the generated credits list from `source`.
- `build.py --public` excludes any source marked as not yet cleared for redistribution
  (currently: CCEL-derived data, pending permission). Local builds can include everything open.
- Never bundled: anything in `excluded:` of `sources.yaml`.

---

## 11. Example: the witness timeline for a verse

```sql
-- Everything that bears witness to John 1:18, oldest first
SELECT type, id, year_from, year_to, detail
FROM verse_witness
WHERE start_vkey <= 43001018 AND end_vkey >= 43001018
ORDER BY COALESCE(year_from, 9999);
```
Combined with `variant_witness` (who reads θεός vs υἱός) this produces the strip:
*written c. 90 → P66/P75 (c. 200) → Irenaeus, Clement, Origen → Sinaiticus/Vaticanus (4th c.)
→ Textus Receptus (1516–1633) → NA28/SBL today.*

---

## 12. Size estimate

| Group | Rows (approx.) |
|---|---|
| `edition_verse` (~25 editions) | 0.8 M |
| `token` (TAGNT, TAHOT, MACULA ×2, LXX) | 2.5 M |
| `crossref` | 0.35 M + TSK |
| `work_section` (ANF + NPNF + others) | 0.3 M |
| `commentary_entry` | 0.2 M |
| `citation` | 0.1 M |
| `syntax_node` | 1.5 M |
| **core.db with FTS** | **≈ 3–6 GB** |

---

## 13. Extensibility & AI

The schema is designed so new features — including AI — can be added without redesign.

### 13.1 Universal URIs
Every item has a URI `<type>:<id>[#<fragment>]` ([`testimonia/uri.py`](../testimonia/uri.py)):
`verse:John.1.18`, `verse:John.1.18-John.1.20`, `person:irenaeus`, `work:irenaeus.haer`,
`section:irenaeus.haer@anf#3.11.6`, `ms:GA:P66`, `lemma:G3439`, `edition:kjv`, `note:<uuid>`.
URIs connect core.db, user.db, ai.db, markdown notes, links in the UI and AI citations.
The `entity` view lists every named item with its URI and title (universal search / grounding).
A new kind of entity only needs a new URI type.

### 13.2 Extension points in core.db
| Need | Mechanism |
|---|---|
| New property on any item | `entity_attr (uri, key, value JSON, lang, confidence, source_id)` |
| New relationship between items | `entity_link (src, rel, dst, weight, confidence, review, source_id)` — a knowledge graph |
| Multilingual names / UI data | `label (uri, lang, field, text)` |
| Images, audio, facsimiles | `media` + `entity_link` |
| A whole new feature with its own tables | a module: `schema/modules/<name>.sql`, recorded in `module` |
| New data source | a `sources.yaml` entry + `testimonia/ingest/<source>.py` |

### 13.3 Machine-generated data is always labelled
- `source.kind` is `dataset`, `curated`, `machine` or `api`; machine sources record `method`
  and `model`. `source.public = 0` keeps a source out of public builds.
- Inferred rows (`citation`, `quotation`, `crossref`, `dating`, `entity_link`) carry
  `confidence` (0–1) and `review` (`accepted` / `unreviewed` / `rejected`).
- The UI can therefore always show *who* claims something (scholar, dataset, algorithm, AI) and
  filter out unreviewed machine output.

### 13.4 ai.db (optional, rebuildable — `schema/ai.sql`)
| Table | Purpose |
|---|---|
| `embedding_model` | each embedding model (provider, dimension, distance); several can coexist |
| `chunk` | retrievable units (scripture windows, work sections, commentary, lexicon, user notes) with URI, scripture range, **date**, author — so retrieval can be restricted, e.g. to pre-Nicene sources |
| `embedding` | float32 vectors per (chunk, model); optional `sqlite-vec` index created at runtime |
| `fts_chunk` | keyword index for hybrid (BM25 + vector) retrieval |
| `ai_cache` | cached outputs keyed by task + model + prompt version + inputs |
| `ai_run`, `ai_proposal` | batch AI jobs and their proposals (allusions, links, datings…) awaiting review |

Workflow for AI-discovered knowledge: **AI proposes** (`ai_proposal`) → **a person reviews** →
accepted items are exported to `curated/` (citing the evidence) → they enter core.db in the next
build, attributed to a `machine` or `curated` source. Nothing an AI produces enters the
reference data unreviewed.

### 13.5 AI conversations
`user.db` stores assistant conversations (`ai_conversation`, `ai_message`, `ai_feedback`).
Each assistant message records the URIs it was given (`context_uris`) and the URIs it cited
(`citations`), so answers can always be checked against the real texts.

### 13.6 Planned AI features this supports
- Ask questions of the library with cited answers ("How did pre-Nicene writers read Gen 1:26?").
- Era-aware retrieval (only sources before AD 325, or before a chosen date).
- Explain a variant, a manuscript, a word study, or a passage in context.
- Suggest allusions to scripture in ancient works; propose datings or links — always as reviewable proposals.
- Semantic search across translations, fathers and notes; "similar passages".
- Drafting help for your own translation, grounded in the lexicons and interlinear.
