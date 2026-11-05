-- =====================================================================================
--  TESTIMONIA — core database schema  (SQLite 3.40+, FTS5)
--
--  core.db is a BUILD ARTIFACT: it is generated from open sources by the ingest
--  pipeline and can be deleted and rebuilt at any time. User data lives in user.db.
--
--  Conventions
--  -----------
--  * vkey  INTEGER  = book_ord*1_000_000 + chapter*1_000 + verse   (hub versification, see §2)
--                     verse 0 = chapter heading / superscription-level notes.
--                     Ranges are stored as (start_vkey, end_vkey) inclusive.
--  * Years INTEGER  = astronomical years: 1 AD = 1, 1 BC = 0, 2 BC = -1, 1446 BC = -1445.
--                     The UI converts to BC/AD. Never store year strings as data.
--  * IDs   TEXT     = stable human-readable slugs for entities ('irenaeus', 'irenaeus.haer',
--                     'GA:P66', 'kjv'), so URLs and curated CSV files stay readable.
--  * Every data row carries source_id → source(id): licence & attribution are tracked per row,
--    which lets us generate the credits page and a licence-filtered public build.
--  * URIs  TEXT     = universal references to ANY item, "<type>:<id>[#<fragment>]":
--                     verse:John.1.18  verse:John.1.18-John.1.20  person:irenaeus  work:irenaeus.haer
--                     section:irenaeus.haer@anf#3.11.6  ms:GA:P66  lemma:G3439  edition:kjv  note:<uuid>
--                     Used by entity_link, entity_attr, ai.db chunks, user notes and AI citations
--                     (see testimonia/uri.py). Adding a new kind of entity = adding a new <type>.
--
--  Extensibility
--  -------------
--  * New properties  → entity_attr (typed key/value per entity) before adding columns.
--  * New relations   → entity_link (typed edges between any two URIs) before adding tables.
--  * New features    → a module: schema/modules/<name>.sql + ingest code, registered in `module`.
--                      Module tables are prefixed with the module name (e.g. audio_*, syntax_*).
--  * Machine-made data (AI, heuristics) comes from a source with kind='machine' and carries
--    confidence + review status, so it is always distinguishable from scholarly data.
--  * Embeddings / AI caches live in ai.db (schema/ai.sql), never here.
-- =====================================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 2;   -- core schema version: bump on every change (core.db is rebuilt, never migrated)

-- =====================================================================================
-- §1  PROVENANCE & LICENSING
-- =====================================================================================

CREATE TABLE source (
  id            TEXT PRIMARY KEY,          -- 'btb', 'stepbible-tagnt', 'ccel-anf', 'theographic' …
  name          TEXT NOT NULL,
  publisher     TEXT,
  url           TEXT,                      -- homepage / repo
  download_url  TEXT,
  version       TEXT,                      -- git commit, release tag or date
  license       TEXT NOT NULL CHECK (license <> ''),  -- SPDX-ish: 'CC0-1.0','PD','CC-BY-4.0','CC-BY-SA-4.0','MIT'
  attribution   TEXT,                      -- exact credit line required by the licence
  share_alike   INTEGER NOT NULL DEFAULT 0 CHECK (share_alike IN (0, 1)),
  fetched_at    TEXT,
  sha256        TEXT,
  kind          TEXT NOT NULL DEFAULT 'dataset'
                CHECK (kind IN ('dataset','curated','machine','api')),
                -- dataset = published open data; curated = hand-encoded in curated/;
                -- machine = produced by an algorithm or AI model (see method/model);
                -- api = metadata from a live API snapshot
  method        TEXT,                      -- machine sources: 'citation-extractor', 'llm-allusion-tagger'
  model         TEXT,                      -- machine sources: model name + version, e.g. 'claude-opus-5-5'
  public        INTEGER NOT NULL DEFAULT 1 CHECK (public IN (0, 1)),  -- 0 = excluded from --public builds
  notes         TEXT
) STRICT;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT) STRICT;   -- build date, schema version, etc.

-- Add-on modules (future features) that contributed tables/data to this build.
CREATE TABLE module (
  id             TEXT PRIMARY KEY,         -- 'core','syntax','audio','maps','ai-annotations'
  version        TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  description    TEXT,
  installed_at   TEXT
) STRICT;

-- Generic typed properties for any entity — lets new features attach data without schema changes.
CREATE TABLE entity_attr (
  uri         TEXT NOT NULL,               -- 'person:irenaeus', 'ms:GA:P66', 'verse:John.1.18'
  key         TEXT NOT NULL,               -- namespaced: 'bio.birthplace', 'ms.leaves', 'audio.url'
  value       TEXT NOT NULL,               -- JSON-encoded value
  lang        TEXT NOT NULL DEFAULT '',    -- '' = language-neutral
  confidence  REAL CHECK (confidence BETWEEN 0 AND 1),
  source_id   TEXT NOT NULL REFERENCES source(id),
  CHECK (json_valid(value)),
  PRIMARY KEY (uri, key, lang, source_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX entity_attr_key ON entity_attr(key);

-- Generic typed relationships between any two items (knowledge graph). Specific tables
-- (person_ref, citation, crossref…) stay for hot paths; this holds the long tail and
-- anything discovered later — including machine/AI-proposed links pending review.
CREATE TABLE entity_link (
  id          INTEGER PRIMARY KEY,
  src         TEXT NOT NULL,               -- URI
  rel         TEXT NOT NULL,               -- 'alludes_to','disciple_of','located_at','depicts','same_as',
                                           -- 'responds_to','quotes','attests','refutes','mentions'
  dst         TEXT NOT NULL,               -- URI
  weight      REAL,                        -- strength / votes / similarity
  confidence  REAL CHECK (confidence BETWEEN 0 AND 1),
  review      TEXT NOT NULL DEFAULT 'accepted'
              CHECK (review IN ('accepted','unreviewed','rejected')),
  note        TEXT,
  source_id   TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE INDEX entity_link_src ON entity_link(src, rel);
CREATE INDEX entity_link_dst ON entity_link(dst, rel);

-- Names/labels in other languages for any entity (multilingual UI: Tamil, Spanish, Greek…).
CREATE TABLE label (
  uri         TEXT NOT NULL,
  lang        TEXT NOT NULL,               -- BCP-47: 'ta', 'es', 'grc', 'he'
  field       TEXT NOT NULL DEFAULT 'name',-- 'name','title','summary'
  text        TEXT NOT NULL,
  source_id   TEXT REFERENCES source(id),
  PRIMARY KEY (uri, lang, field)
) STRICT, WITHOUT ROWID;

-- Media assets (images, audio, map tiles packs, manuscript facsimile links) — always with licence via source.
CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('image','audio','video','map','document','iiif')),
  url         TEXT,                        -- remote URL (link only) …
  path        TEXT,                        -- … or path relative to the data dir (bundled)
  mime        TEXT,
  title       TEXT,
  credit      TEXT,                        -- per-item credit line when it differs from the source
  source_id   TEXT NOT NULL REFERENCES source(id),
  CHECK (url IS NOT NULL OR path IS NOT NULL)
) STRICT;
-- media is attached to items through entity_link (rel = 'depicts' / 'audio_of' / 'facsimile_of').

-- External identifiers for any entity (Wikidata QID, Pleiades, TLG, CPG, Gregory-Aland, Trismegistos…)
CREATE TABLE external_id (
  entity_type TEXT NOT NULL,               -- 'person','work','place','manuscript','event','book','lemma'
  entity_id   TEXT NOT NULL,
  scheme      TEXT NOT NULL,               -- 'wikidata','pleiades','tlg','cpg','cpl','clavis_apoc','ga','tm','ldab','strong'
  value       TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, scheme, value)
) STRICT, WITHOUT ROWID;
CREATE INDEX external_id_lookup ON external_id(scheme, value);

-- =====================================================================================
-- §2  CANON, BOOKS & VERSIFICATION
--   The hub versification is English (KJV + Apocrypha as in KJVA/NRSV). Every text is
--   stored in its NATIVE numbering too; verse_map translates (from STEPBible TVTMS).
-- =====================================================================================

CREATE TABLE book (
  osis         TEXT PRIMARY KEY,           -- 'Gen', '1Kgs', 'Sir', '1En' (pseudepigrapha allowed)
  ord          INTEGER NOT NULL UNIQUE CHECK (ord BETWEEN 1 AND 999),  -- hub order, used in vkey
  name         TEXT NOT NULL,
  short_name   TEXT,
  testament    TEXT NOT NULL CHECK (testament IN ('OT','NT','DC','EX')),  -- EX = extra-canonical (1 Enoch, Jubilees...)
  hebrew_name  TEXT,                       -- בְּרֵאשִׁית
  greek_name   TEXT,                       -- Γένεσις
  latin_name   TEXT,                       -- Genesis
  chapters     INTEGER,
  genre        TEXT,                       -- 'law','history','wisdom','prophecy','gospel','epistle','apocalyptic'
  orig_language TEXT                       -- 'hbo','arc','grc'
) STRICT;

-- Book order & status per canon tradition (Tanakh sections, LXX order, Vulgate, Protestant, Orthodox, Ethiopian…)
CREATE TABLE canon_tradition (
  id          TEXT PRIMARY KEY,            -- 'tanakh','protestant','catholic','orthodox','ethiopian','lxx','vulgate'
  name        TEXT NOT NULL,
  description TEXT
) STRICT;
CREATE TABLE canon_book (
  tradition_id TEXT NOT NULL REFERENCES canon_tradition(id),
  book         TEXT NOT NULL REFERENCES book(osis),
  ord          INTEGER NOT NULL,
  division     TEXT,                       -- 'Torah','Nevi''im Rishonim','Ketuvim','Pentateuch','Gospels'…
  status       TEXT DEFAULT 'canonical',   -- 'canonical','deuterocanonical','appendix'
  PRIMARY KEY (tradition_id, book)
) STRICT, WITHOUT ROWID;

CREATE TABLE versification (
  id          TEXT PRIMARY KEY,            -- 'eng' (hub), 'heb', 'lxx', 'vul', 'nrsv'
  name        TEXT NOT NULL,
  description TEXT
) STRICT;

-- Every verse in the hub scheme.
CREATE TABLE verse (
  vkey        INTEGER PRIMARY KEY,
  osis        TEXT NOT NULL UNIQUE,        -- 'John.1.18'
  book        TEXT NOT NULL REFERENCES book(osis),
  chapter     INTEGER NOT NULL CHECK (chapter BETWEEN 0 AND 999),
  verse       INTEGER NOT NULL CHECK (verse BETWEEN 0 AND 999),
  red_letter  INTEGER NOT NULL DEFAULT 0 CHECK (red_letter IN (0, 1))   -- words of Jesus (from BTB jesus_said)
) STRICT;
CREATE INDEX verse_book_ch ON verse(book, chapter);

-- Native reference → hub vkey. relation: '=' identical, 'part' native verse is part of hub verse,
-- 'split' native verse covers several hub verses (one row each), 'absent' no hub equivalent.
CREATE TABLE verse_map (
  versification_id TEXT NOT NULL REFERENCES versification(id),
  native_ref  TEXT NOT NULL,               -- 'Ps.22.1' in LXX = hub 'Ps.23.1'; 'Mal.3.19' (heb) = 'Mal.4.1'
  vkey        INTEGER NOT NULL REFERENCES verse(vkey),
  relation    TEXT NOT NULL DEFAULT '=' CHECK (relation IN ('=','part','split','absent')),
  source_id   TEXT REFERENCES source(id),
  PRIMARY KEY (versification_id, native_ref, vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX verse_map_vkey ON verse_map(vkey);

-- Section headings / pericopes / outlines (BTB pericopes, BSB headings, Hebrew petuchot/setumot…)
CREATE TABLE heading (
  id          INTEGER PRIMARY KEY,
  scheme      TEXT NOT NULL,               -- 'btb-pericope','bsb','parashah','petucha','setuma','kephalaia'
  start_vkey  INTEGER NOT NULL,
  end_vkey    INTEGER NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  title       TEXT,
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE INDEX heading_range ON heading(start_vkey, end_vkey);

-- =====================================================================================
-- §3  TEXTS — one model for translations, original-language editions & manuscript transcriptions
-- =====================================================================================

CREATE TABLE edition (
  id            TEXT PRIMARY KEY,          -- 'kjv','bsb','web','brenton','vulgate-clementine','wlc','sblgnt',
                                           -- 'byz-rp2005','tr-scrivener','swete-lxx','mam-aleppo','cntr:P66'
  title         TEXT NOT NULL,
  abbrev        TEXT,
  language      TEXT NOT NULL,             -- ISO 639-3: 'eng','hbo','arc','grc','lat','syc'
  script_dir    TEXT NOT NULL DEFAULT 'ltr' CHECK (script_dir IN ('ltr','rtl')),
  kind          TEXT NOT NULL CHECK (kind IN ('translation','critical_edition','reading_text','manuscript','targum','interlinear')),
  testament     TEXT,                      -- 'OT','NT','both','DC'
  versification_id TEXT REFERENCES versification(id),
  year          INTEGER,                   -- publication year (astronomical)
  base_text     TEXT,                      -- 'MT','LXX','TR','Byz','critical','Vulgate','Peshitta'
  manuscript_id TEXT,                      -- for kind='manuscript' → manuscript(id)
  description   TEXT,
  sort          INTEGER DEFAULT 100,
  source_id     TEXT NOT NULL REFERENCES source(id),
  CHECK (kind <> 'manuscript' OR manuscript_id IS NOT NULL)
) STRICT;

CREATE TABLE edition_verse (
  edition_id  TEXT NOT NULL REFERENCES edition(id),
  vkey        INTEGER NOT NULL,            -- hub key (after verse_map)
  native_ref  TEXT,                        -- only when it differs from the hub osis
  text        TEXT NOT NULL,               -- plain text (search, diff)
  markup      TEXT,                        -- optional light HTML: red letters, italics, poetry lines, lacunae
  PRIMARY KEY (edition_id, vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX edition_verse_vkey ON edition_verse(vkey);

-- Footnotes that belong to a specific edition (translator notes, KJV marginalia, Brenton notes)
CREATE TABLE edition_note (
  edition_id  TEXT NOT NULL REFERENCES edition(id),
  vkey        INTEGER NOT NULL,
  n           INTEGER NOT NULL,
  kind        TEXT,                        -- 'translation','alternative','textual','study'
  body        TEXT NOT NULL,               -- HTML
  PRIMARY KEY (edition_id, vkey, n)
) STRICT, WITHOUT ROWID;

-- =====================================================================================
-- §4  ORIGINAL-LANGUAGE WORDS, LEXICA, MORPHOLOGY, SYNTAX
-- =====================================================================================

CREATE TABLE lemma (
  id          TEXT PRIMARY KEY,            -- extended Strong's where available: 'G3439','H0430G'
  language    TEXT NOT NULL CHECK (language IN ('grc','hbo','arc','lat','syc','cop')),
  lemma       TEXT NOT NULL,               -- μονογενής
  translit    TEXT,
  pronunciation TEXT,
  gloss       TEXT,                        -- short English gloss
  definition  TEXT,                        -- one-line definition
  ln          TEXT,                        -- Louw-Nida domain(s) '58.52'
  sdbh        TEXT,                        -- Hebrew semantic domain (UBS SDBH)
  frequency   INTEGER,                     -- computed at build
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE INDEX lemma_lemma ON lemma(lemma);

-- Full lexicon articles: BDB, Abbott-Smith, LSJ, UBS Greek NT Dict, UBS SDBH, TBESG/TBESH, Dodson, TIPNR…
CREATE TABLE lexicon (
  id          TEXT PRIMARY KEY,            -- 'bdb','abbott-smith','lsj','ubs-gnt','ubs-sdbh','tbesh','tbesg','tipnr'
  title       TEXT NOT NULL,
  language    TEXT NOT NULL,
  year        INTEGER,
  source_id   TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE TABLE lexicon_entry (
  lexicon_id  TEXT NOT NULL REFERENCES lexicon(id),
  lemma_id    TEXT NOT NULL,               -- → lemma(id) (soft link: some entries precede lemma ingest)
  headword    TEXT,
  body        TEXT NOT NULL,               -- HTML
  PRIMARY KEY (lexicon_id, lemma_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX lexicon_entry_lemma ON lexicon_entry(lemma_id);

-- Word senses / semantic domains (UBS dictionaries — the "Bible Sense Lexicon" layer)
CREATE TABLE semantic_domain (
  id          TEXT PRIMARY KEY,            -- 'LN:33','LN:33.98','SDBH:003001'
  parent_id   TEXT,
  system      TEXT NOT NULL,               -- 'louw-nida','sdbh'
  label       TEXT NOT NULL,
  description TEXT,
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE TABLE lemma_sense (
  lemma_id    TEXT NOT NULL,
  n           INTEGER NOT NULL,
  domain_id   TEXT REFERENCES semantic_domain(id),
  gloss       TEXT,
  definition  TEXT,
  source_id   TEXT REFERENCES source(id),
  PRIMARY KEY (lemma_id, n, source_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE morph_code (
  scheme      TEXT NOT NULL,               -- 'robinson','oshb','step'
  code        TEXT NOT NULL,               -- 'V-AAI-3S','HVqp3ms'
  pos         TEXT, person TEXT, tense TEXT, voice TEXT, mood TEXT, "case" TEXT,
  number      TEXT, gender TEXT, state TEXT, stem TEXT,
  description TEXT,                        -- human readable
  PRIMARY KEY (scheme, code)
) STRICT, WITHOUT ROWID;

-- One row per word (Hebrew: per word with prefixes kept as morphemes in `parts`).
CREATE TABLE token (
  id          INTEGER PRIMARY KEY,
  edition_id  TEXT NOT NULL REFERENCES edition(id),   -- 'tagnt','tahot','macula-sblgnt','macula-wlc','lxx-swete'
  vkey        INTEGER NOT NULL,
  pos         INTEGER NOT NULL CHECK (pos >= 1),  -- word position in verse (1-based)
  surface     TEXT NOT NULL,               -- as printed, with accents/points
  normalized  TEXT,                        -- accent-stripped lowercase (search)
  lemma_id    TEXT,                        -- → lemma(id)
  strong      TEXT,                        -- may hold several for Hebrew morphemes 'H9003 H7225G'
  morph       TEXT,                        -- 'N-NSM','HR/Ncfsa'
  translit    TEXT,
  gloss       TEXT,                        -- contextual English gloss
  parts       TEXT,                        -- JSON: Hebrew morpheme breakdown [{surface,strong,morph}]
  domain_id   TEXT,                        -- semantic domain in context (MACULA ln / sdbh)
  referent    TEXT,                        -- MACULA referent id (who 'he' refers to)
  lxx_equiv   TEXT,                        -- Hebrew tokens: Greek LXX equivalent lemma(s) (MACULA Hebrew)
  editions    TEXT,                        -- NT (TAGNT): '+'-joined editions containing this word
  word_type   TEXT,                        -- TAGNT 'NKO','N(K)O','ko'… / TAHOT 'L','Q','K','R','X'
  UNIQUE (edition_id, vkey, pos)
) STRICT;
CREATE INDEX token_vkey   ON token(vkey);
CREATE INDEX token_lemma  ON token(lemma_id);
CREATE INDEX token_strong ON token(strong);
CREATE INDEX token_norm   ON token(normalized);

-- Syntax trees (MACULA lowfat): one row per word-group node; leaves point at token ranges.
CREATE TABLE syntax_node (
  id          TEXT PRIMARY KEY,            -- MACULA xml:id
  edition_id  TEXT NOT NULL REFERENCES edition(id),
  parent_id   TEXT,
  vkey_start  INTEGER NOT NULL,
  vkey_end    INTEGER NOT NULL,
  first_token INTEGER, last_token INTEGER, -- token(id) span
  class       TEXT,                        -- 'cl','np','vp','pp'…
  rule        TEXT,                        -- 'P-VC-S'
  role        TEXT,                        -- 's','v','o','io','p','adv'
  depth       INTEGER
) STRICT;
CREATE INDEX syntax_node_parent ON syntax_node(parent_id);
CREATE INDEX syntax_node_range  ON syntax_node(vkey_start);

-- Token-level alignment between two editions (MT↔LXX, Greek↔English gloss alignment…)
CREATE TABLE alignment (
  token_a     INTEGER NOT NULL,
  token_b     INTEGER NOT NULL,
  kind        TEXT,                        -- 'mt-lxx','orig-eng'
  source_id   TEXT REFERENCES source(id),
  PRIMARY KEY (token_a, token_b)
) STRICT, WITHOUT ROWID;

-- =====================================================================================
-- §5  TEXTUAL CRITICISM — variants, apparatus, manuscripts (OT and NT)
-- =====================================================================================

-- A place where witnesses disagree.
CREATE TABLE variant_unit (
  id          INTEGER PRIMARY KEY,
  start_vkey  INTEGER NOT NULL,
  end_vkey    INTEGER NOT NULL,
  testament   TEXT NOT NULL,
  label       TEXT,                        -- 'μονογενὴς θεός / ὁ μονογενὴς υἱός'
  significance TEXT,                       -- 'meaning','spelling','order','omission','addition'
  note        TEXT,                        -- plain-English explanation (TAGNT / HOTTP)
  rating      TEXT,                        -- HOTTP A–D, etc.
  source_id   TEXT NOT NULL REFERENCES source(id),
  CHECK (start_vkey <= end_vkey)
) STRICT;
CREATE INDEX variant_unit_range ON variant_unit(start_vkey, end_vkey);

CREATE TABLE variant_reading (
  unit_id     INTEGER NOT NULL REFERENCES variant_unit(id),
  n           INTEGER NOT NULL,
  text        TEXT NOT NULL,               -- the reading ('' = omission)
  gloss       TEXT,                        -- English meaning of the reading
  is_preferred INTEGER,                    -- per the source edition
  PRIMARY KEY (unit_id, n)
) STRICT, WITHOUT ROWID;

-- Who supports a reading: an edition (NA28, TR…), a manuscript, a father, or an ancient version.
CREATE TABLE variant_witness (
  unit_id     INTEGER NOT NULL,
  n           INTEGER NOT NULL,
  witness_type TEXT NOT NULL CHECK (witness_type IN ('edition','manuscript','father','version')),
  witness_id  TEXT NOT NULL,               -- 'NA28' | 'GA:P66' | 'origen' | 'syr-pesh'
  qualifier   TEXT,                        -- 'vid','corrector','marg','partial'
  PRIMARY KEY (unit_id, n, witness_type, witness_id)
) STRICT, WITHOUT ROWID;

-- Physical manuscripts: NT (Gregory-Aland), LXX (Rahlfs), Hebrew (Leningrad, Aleppo, DSS scrolls),
-- versions (Vulgate, Peshitta, Coptic…). Metadata from Wikipedia lists (CC BY-SA) + Wikidata (CC0).
CREATE TABLE manuscript (
  id          TEXT PRIMARY KEY,            -- 'GA:P66','GA:01','GA:1739','DSS:1QIsaa','HEB:Leningrad','LXX:B'
  sigla       TEXT,                        -- 'P66', '01 / א', '1QIsaᵃ'
  name        TEXT,                        -- 'Papyrus Bodmer II', 'Codex Sinaiticus', 'Great Isaiah Scroll'
  collection  TEXT,                        -- 'NT papyri','NT majuscules','DSS','LXX codices','Masoretic codices'
  language    TEXT,
  format      TEXT,                        -- 'codex','scroll','roll','fragment','lectionary'
  material    TEXT,                        -- 'papyrus','parchment','paper'
  date_from   INTEGER, date_to INTEGER,    -- astronomical years (window)
  date_label  TEXT,                        -- 'c. 200', 'III/IV', 'mid-2nd c. BC'
  script      TEXT,                        -- palaeographic script/period: 'Herodian','Hasmonean','paleo-Hebrew',
                                           -- 'biblical majuscule','minuscule' (often the only dating evidence)
  contents    TEXT,                        -- human-readable summary
  text_type   TEXT,                        -- 'Alexandrian','Byzantine','Western','proto-MT','pre-Samaritan'…
  institution TEXT, city TEXT, country TEXT, shelfmark TEXT,
  discovered  TEXT,                        -- where/when found ('Qumran Cave 1, 1947'); DJD vol. → external_id scheme 'djd'
  place_id    TEXT,                        -- → place(id) (origin / find spot)
  image_url   TEXT,                        -- IIIF / viewer link (link only)
  description TEXT,
  source_id   TEXT NOT NULL REFERENCES source(id),
  CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
) STRICT;

-- Which verses a manuscript contains (ranges).
CREATE TABLE manuscript_coverage (
  manuscript_id TEXT NOT NULL REFERENCES manuscript(id),
  start_vkey  INTEGER NOT NULL,
  end_vkey    INTEGER NOT NULL,
  completeness TEXT CHECK (completeness IN ('full','partial','fragmentary')),
  source_id   TEXT REFERENCES source(id),
  CHECK (start_vkey <= end_vkey)
) STRICT;
CREATE INDEX ms_cov_range ON manuscript_coverage(start_vkey, end_vkey);
CREATE INDEX ms_cov_ms    ON manuscript_coverage(manuscript_id);

-- =====================================================================================
-- §6  PEOPLE, PLACES, EVENTS — the "Factbook" layer
-- =====================================================================================

-- One table for biblical people, church fathers, rulers, rabbis, scholars…
CREATE TABLE person (
  id          TEXT PRIMARY KEY,            -- 'abraham', 'irenaeus', 'hezekiah', 'constantine-i'
  name        TEXT NOT NULL,
  alt_names   TEXT,                        -- JSON array
  sex         TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('biblical','father','author','ruler','heretic','martyr','rabbi','scholar','other')),
  -- life dates are stored in `dating` (multiple chronology systems); these are display defaults:
  born        INTEGER, died INTEGER, floruit_from INTEGER, floruit_to INTEGER,
  era         TEXT,                        -- 'apostolic','ante-nicene','nicene','post-nicene','medieval','reformation','modern', or OT eras
  tradition   TEXT,                        -- 'proto-orthodox','gnostic','montanist','jewish','pagan'
  place_id    TEXT,                        -- primary place (see) → place(id)
  summary     TEXT,                        -- one line
  bio         TEXT,                        -- HTML
  strong      TEXT,                        -- biblical names: Strong's number(s)
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE INDEX person_kind ON person(kind);

CREATE TABLE person_relation (
  person_a    TEXT NOT NULL, relation TEXT NOT NULL, person_b TEXT NOT NULL,   -- 'father_of','spouse_of','disciple_of','opponent_of'
  source_id   TEXT REFERENCES source(id),
  PRIMARY KEY (person_a, relation, person_b)
) STRICT, WITHOUT ROWID;

-- Offices held: 'King of Judah', 'Roman Emperor', 'Bishop of Rome', 'High Priest', 'Bishop of Lyon'
CREATE TABLE office_holding (
  id          TEXT PRIMARY KEY,            -- 'hezekiah@king-judah'
  person_id   TEXT NOT NULL REFERENCES person(id),
  office      TEXT NOT NULL,
  seq         INTEGER,                     -- order in the succession list
  notes       TEXT,
  source_id   TEXT REFERENCES source(id)
) STRICT;

CREATE TABLE person_ref (                  -- verses mentioning a (biblical) person
  person_id   TEXT NOT NULL, vkey INTEGER NOT NULL,
  PRIMARY KEY (person_id, vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX person_ref_vkey ON person_ref(vkey);

CREATE TABLE place (
  id          TEXT PRIMARY KEY,            -- 'jerusalem','antioch-syria','lyon'
  name        TEXT NOT NULL,
  alt_names   TEXT,                        -- JSON (ancient/modern names, Greek/Hebrew/Latin forms)
  kind        TEXT,                        -- 'city','region','mountain','river','sea','site'
  lat REAL CHECK (lat BETWEEN -90 AND 90), lon REAL CHECK (lon BETWEEN -180 AND 180),
  precision   TEXT CHECK (precision IN ('exact','approximate','unknown')),
  modern_name TEXT,
  summary     TEXT,
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE TABLE place_ref (
  place_id    TEXT NOT NULL, vkey INTEGER NOT NULL,
  PRIMARY KEY (place_id, vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX place_ref_vkey ON place_ref(vkey);

-- Geometry for routes / regions (UBS journeys, Roman roads, provinces) as GeoJSON
CREATE TABLE geo_feature (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,               -- 'route','road','province','region'
  name        TEXT,
  geojson     TEXT NOT NULL,
  date_from   INTEGER, date_to INTEGER,
  source_id   TEXT REFERENCES source(id)
) STRICT;

CREATE TABLE event (
  id          TEXT PRIMARY KEY,            -- 'exodus','fall-of-samaria','council-of-nicaea','persecution-decius'
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- 'biblical','political','church','council','persecution','composition',
                                           -- 'archaeological','literary','natural'
  description TEXT,
  place_id    TEXT,
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE TABLE event_participant (
  event_id TEXT NOT NULL, person_id TEXT NOT NULL, role TEXT,
  PRIMARY KEY (event_id, person_id)
) STRICT, WITHOUT ROWID;
CREATE TABLE event_ref (                   -- Bible passages narrating the event
  event_id TEXT NOT NULL, start_vkey INTEGER NOT NULL, end_vkey INTEGER NOT NULL,
  PRIMARY KEY (event_id, start_vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX event_ref_range ON event_ref(start_vkey);

-- =====================================================================================
-- §7  CHRONOLOGY — first-class, with competing systems side by side
--   Anything can be dated (event, person, office_holding, book composition, work, manuscript,
--   verse narrative-time) under any chronology system, each with its own uncertainty.
-- =====================================================================================

CREATE TABLE chronology_system (
  id          TEXT PRIMARY KEY,            -- 'ussher','jones','thiele','galil','albright','scholarly',
                                           -- 'traditional','btb','wikidata'
  name        TEXT NOT NULL,               -- 'Ussher (1650)', 'Thiele, Mysterious Numbers (1983)'
  kind        TEXT,                        -- 'young-earth','conservative','critical','consensus'
  description TEXT,
  source_id   TEXT REFERENCES source(id)
) STRICT;

CREATE TABLE dating (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,               -- 'event','person','office_holding','book','work','manuscript','period'
  entity_id   TEXT NOT NULL,
  aspect      TEXT NOT NULL DEFAULT 'when',-- 'when','birth','death','floruit','reign','composition','setting'
  system_id   TEXT NOT NULL REFERENCES chronology_system(id),
  date_kind   TEXT NOT NULL CHECK (date_kind IN ('point','span','window')),  -- point (start=end) | span (lasted start→end) |
                                           -- 'window' (happened once, sometime between start and end)
  start_year  INTEGER,                     -- astronomical
  end_year    INTEGER,
  start_month INTEGER CHECK (start_month BETWEEN 1 AND 12),
  start_day   INTEGER CHECK (start_day BETWEEN 1 AND 31),
  precision   TEXT CHECK (precision IN ('day','month','year','decade','quarter-century','half-century','century','millennium')),
  circa       INTEGER NOT NULL DEFAULT 0 CHECK (circa IN (0, 1)),
  label       TEXT,                        -- as the source states it: '~AD 26–27', 'c. 1446 BC'
  basis       TEXT,                        -- why: 'internal evidence','palaeography','C14','tradition'
  confidence  REAL CHECK (confidence BETWEEN 0 AND 1),   -- NULL = not applicable / curated
  review      TEXT NOT NULL DEFAULT 'accepted' CHECK (review IN ('accepted','unreviewed','rejected')),
  source_id   TEXT REFERENCES source(id),
  CHECK (start_year IS NOT NULL OR end_year IS NOT NULL),
  CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year),
  CHECK (date_kind <> 'point' OR end_year IS NULL OR start_year = end_year)
) STRICT;
CREATE INDEX dating_entity ON dating(entity_type, entity_id);
CREATE INDEX dating_years  ON dating(start_year, end_year);

-- Narrative time of each verse (Ussher via TSK/Theographic, BTB chronology) — dense, so its own table.
CREATE TABLE verse_date (
  vkey        INTEGER NOT NULL,
  system_id   TEXT NOT NULL REFERENCES chronology_system(id),
  start_year  INTEGER, end_year INTEGER,
  label       TEXT,
  chron_order INTEGER,                     -- BTB chronological reading order
  PRIMARY KEY (vkey, system_id)
) STRICT, WITHOUT ROWID;

-- Named periods / eras (Patriarchal, United Kingdom, Exile, Second Temple, Ante-Nicene…)
CREATE TABLE period (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT,
  scope       TEXT,                        -- 'biblical','church','ane','roman'
  sort        INTEGER,
  description TEXT,
  source_id   TEXT REFERENCES source(id)
  -- its dates live in `dating` (entity_type='period')
) STRICT;
CREATE TABLE verse_period (
  vkey INTEGER NOT NULL, period_id TEXT NOT NULL,
  PRIMARY KEY (vkey, period_id)
) STRICT, WITHOUT ROWID;

-- =====================================================================================
-- §8  ANCIENT LITERATURE — fathers, apocrypha, pseudepigrapha, gnostic, Jewish, pagan
-- =====================================================================================

CREATE TABLE work (
  id            TEXT PRIMARY KEY,          -- 'irenaeus.haer', 'didache', 'gos-thomas', '1enoch', 'josephus.ant'
  title         TEXT NOT NULL,             -- 'Against Heresies'
  alt_titles    TEXT,                      -- JSON: Latin/Greek titles ('Adversus Haereses')
  author_id     TEXT REFERENCES person(id),-- NULL for anonymous
  attribution   TEXT,                      -- 'traditionally ascribed to…', 'pseudonymous'
  category      TEXT NOT NULL,             -- 'church-father','apostolic-father','nt-apocrypha','ot-pseudepigrapha',
                                           -- 'qumran' (non-biblical Dead Sea Scrolls: 1QS, CD, 1QM, 1QpHab…),
                                           -- 'gnostic','jewish','rabbinic','pagan','liturgical','canon-list','martyrology'
  subcategory   TEXT,                      -- 'gospel','acts','apocalypse','apology','homily','letter','commentary'
  era           TEXT,                      -- 'apostolic','ante-nicene','nicene','post-nicene','medieval'…
  orig_language TEXT,
  -- composition date lives in `dating`; these are display defaults:
  date_from     INTEGER, date_to INTEGER,
  summary       TEXT,
  description   TEXT,                      -- HTML
  ref_scheme    TEXT,                      -- how it is cited: 'book.chapter.section', 'chapter.verse'
  ecw_url       TEXT,                      -- link to earlychristianwritings.com (link only)
  other_url     TEXT,
  source_id     TEXT REFERENCES source(id),
  CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
) STRICT;
CREATE INDEX work_author ON work(author_id);
CREATE INDEX work_category ON work(category, era);

-- A particular text of a work: an English translation, the Greek/Latin original, a modern PD translation.
CREATE TABLE work_edition (
  id            TEXT PRIMARY KEY,          -- 'irenaeus.haer@anf', 'didache@lightfoot', '1clem@f1k-grc'
  work_id       TEXT NOT NULL REFERENCES work(id),
  language      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('translation','original','fragment-collection')),
  translator    TEXT,
  year          INTEGER,
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  source_id     TEXT NOT NULL REFERENCES source(id)
) STRICT;

-- Hierarchical sections; `cite` is the standard citation so originals & translations align.
CREATE TABLE work_section (
  edition_id    TEXT NOT NULL REFERENCES work_edition(id),
  ord           INTEGER NOT NULL,          -- reading order within the edition
  cite          TEXT,                      -- '3.11.6'
  parent_ord    INTEGER,
  level         INTEGER NOT NULL DEFAULT 1,
  title         TEXT,
  html          TEXT,                      -- body with scripture refs marked <a data-ref="John.1.18">
  text          TEXT,                      -- plain text for search
  PRIMARY KEY (edition_id, ord)
) STRICT, WITHOUT ROWID;
CREATE INDEX work_section_cite ON work_section(edition_id, cite);

-- Scripture cited by ancient literature (from CCEL scripRef, First1KGreek <bibl>, curated indexes).
CREATE TABLE citation (
  id            INTEGER PRIMARY KEY,
  start_vkey    INTEGER NOT NULL,
  end_vkey      INTEGER NOT NULL,
  work_id       TEXT NOT NULL REFERENCES work(id),
  edition_id    TEXT,                      -- where it was found
  section_ord   INTEGER,
  cite          TEXT,                      -- '3.11.6'
  author_id     TEXT,                      -- denormalised for fast filtering
  year          INTEGER,                   -- denormalised (work date) for chronology filters
  kind          TEXT CHECK (kind IN ('quotation','allusion','reference','comment')),
  reading       TEXT,                      -- the wording the author used (text-critical value!)
  snippet       TEXT,                      -- surrounding text
  confidence    REAL CHECK (confidence BETWEEN 0 AND 1),   -- NULL = not applicable / curated
  review        TEXT NOT NULL DEFAULT 'accepted' CHECK (review IN ('accepted','unreviewed','rejected')),
  source_id     TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE INDEX citation_range ON citation(start_vkey, end_vkey);
CREATE INDEX citation_work  ON citation(work_id);
CREATE INDEX citation_year  ON citation(year);

-- =====================================================================================
-- §9  COMMENTARY — patristic excerpts by verse (Commentaries-Database, Catena Aurea) and
--     classic commentaries (Henry, Gill, Clarke, JFB, Keil-Delitzsch, Calvin)
-- =====================================================================================

CREATE TABLE commentary (
  id          TEXT PRIMARY KEY,            -- 'cdb:origen', 'catena-aurea', 'matthew-henry', 'keil-delitzsch'
  title       TEXT NOT NULL,
  author_id   TEXT REFERENCES person(id),
  kind        TEXT NOT NULL,               -- 'patristic-excerpts','catena','commentary','study-notes'
  year        INTEGER,                     -- for chronology filtering (pre-Nicene default)
  era         TEXT,
  source_id   TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE TABLE commentary_entry (
  id            INTEGER PRIMARY KEY,
  commentary_id TEXT NOT NULL REFERENCES commentary(id),
  start_vkey    INTEGER NOT NULL,
  end_vkey      INTEGER NOT NULL,
  work_title    TEXT,                      -- for excerpts: 'Against Heresies 3.11'
  work_id       TEXT,                      -- when resolvable → work(id)
  html          TEXT NOT NULL,
  source_url    TEXT
) STRICT;
CREATE INDEX commentary_entry_range ON commentary_entry(start_vkey, end_vkey);
CREATE INDEX commentary_entry_comm  ON commentary_entry(commentary_id);

-- =====================================================================================
-- §10  INTERTEXTUALITY — cross references, parallels, quotations
-- =====================================================================================

CREATE TABLE crossref (
  src_start   INTEGER NOT NULL, src_end INTEGER NOT NULL,
  dst_start   INTEGER NOT NULL, dst_end INTEGER NOT NULL,
  votes       INTEGER,                     -- OpenBible relevance votes
  confidence  REAL CHECK (confidence BETWEEN 0 AND 1),   -- NULL = not applicable / curated
  review      TEXT NOT NULL DEFAULT 'accepted' CHECK (review IN ('accepted','unreviewed','rejected')),
  source_id   TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE INDEX crossref_src ON crossref(src_start);
CREATE INDEX crossref_dst ON crossref(dst_start);

-- Parallel passages: synoptic gospels, Samuel–Kings // Chronicles, Psalm 18 // 2 Sam 22, OT-in-NT…
CREATE TABLE parallel_group (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,               -- 'synoptic','ot-parallel','ot-in-nt','doublet'
  title       TEXT,
  aland_no    INTEGER,                     -- Aland synopsis number (gospels)
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE TABLE parallel_member (
  group_id    TEXT NOT NULL REFERENCES parallel_group(id),
  start_vkey  INTEGER NOT NULL,
  end_vkey    INTEGER NOT NULL,
  role        TEXT,                        -- 'source','quoting'
  match_data  TEXT,                        -- JSON word-level match codes (UBS)
  PRIMARY KEY (group_id, start_vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX parallel_member_range ON parallel_member(start_vkey);

-- NT quoting / alluding to OT (and OT-internal quotation); `via` records LXX vs MT form.
CREATE TABLE quotation (
  src_start   INTEGER NOT NULL, src_end INTEGER NOT NULL,     -- the quoting passage
  dst_start   INTEGER NOT NULL, dst_end INTEGER NOT NULL,     -- the quoted passage
  kind        TEXT CHECK (kind IN ('quotation','allusion','echo')),
  via         TEXT,                        -- 'LXX','MT','both','unclear'
  confidence  REAL CHECK (confidence BETWEEN 0 AND 1),   -- NULL = not applicable / curated
  review      TEXT NOT NULL DEFAULT 'accepted' CHECK (review IN ('accepted','unreviewed','rejected')),
  source_id   TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE INDEX quotation_src ON quotation(src_start);
CREATE INDEX quotation_dst ON quotation(dst_start);

-- Study notes keyed to verses that are not commentary (TSK notes from BTB)
CREATE TABLE verse_note (
  vkey        INTEGER NOT NULL,
  n           INTEGER NOT NULL,
  kind        TEXT,                        -- 'tsk','variant','translation'
  body        TEXT NOT NULL,
  source_id   TEXT NOT NULL REFERENCES source(id),
  PRIMARY KEY (vkey, source_id, n)
) STRICT, WITHOUT ROWID;

-- =====================================================================================
-- §11  TOPICS & CANON HISTORY
-- =====================================================================================

CREATE TABLE topic (
  id          TEXT PRIMARY KEY,            -- 'nave:faith', 'torrey:atonement', 'btb:word'
  name        TEXT NOT NULL,
  parent_id   TEXT,
  body        TEXT,                        -- HTML
  source_id   TEXT NOT NULL REFERENCES source(id)
) STRICT;
CREATE TABLE topic_ref (
  topic_id    TEXT NOT NULL, start_vkey INTEGER NOT NULL, end_vkey INTEGER NOT NULL, note TEXT,
  PRIMARY KEY (topic_id, start_vkey, end_vkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX topic_ref_range ON topic_ref(start_vkey);

-- Ancient canon lists: Muratorian, Melito, Origen, Eusebius HE 3.25, Athanasius FL 39, Carthage 397…
CREATE TABLE canon_list (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  author_id   TEXT REFERENCES person(id),
  work_id     TEXT REFERENCES work(id),    -- the primary text (readable in the Library)
  cite        TEXT,                        -- 'HE 3.25'
  testament   TEXT,                        -- 'OT','NT','both'
  region      TEXT,
  description TEXT,
  source_id   TEXT REFERENCES source(id)
  -- date lives in `dating` (entity_type='canon_list')
) STRICT;
CREATE TABLE canon_list_item (
  list_id     TEXT NOT NULL REFERENCES canon_list(id),
  item_type   TEXT NOT NULL CHECK (item_type IN ('book','work')),  -- Hermas, Barnabas, 1 Enoch are works
  item_id     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('accepted','disputed','rejected','spurious','mentioned','omitted')),
  ord         INTEGER,
  note        TEXT,
  PRIMARY KEY (list_id, item_type, item_id)
) STRICT, WITHOUT ROWID;

-- =====================================================================================
-- §12  SCHOLARSHIP (curated bibliography; live API results are cached in user.db)
-- =====================================================================================

CREATE TABLE bibliography (
  id          TEXT PRIMARY KEY,            -- DOI or 'ia:<identifier>' or 'openalex:W…'
  title       TEXT NOT NULL,
  authors     TEXT,
  year        INTEGER,
  venue       TEXT,
  url         TEXT,
  oa_url      TEXT,                        -- open-access PDF if known
  kind        TEXT,                        -- 'article','book','critical-edition','reference'
  public_domain INTEGER DEFAULT 0,         -- e.g. Tischendorf, Swete, Westcott-Hort on archive.org
  source_id   TEXT REFERENCES source(id)
) STRICT;
CREATE TABLE bibliography_link (
  bib_id      TEXT NOT NULL REFERENCES bibliography(id),
  entity_type TEXT NOT NULL,               -- 'verse-range','work','person','manuscript','book','topic'
  entity_id   TEXT NOT NULL,               -- for verse ranges: 'start_vkey-end_vkey'
  PRIMARY KEY (bib_id, entity_type, entity_id)
) STRICT, WITHOUT ROWID;

-- =====================================================================================
-- §13  FULL-TEXT SEARCH  (external-content FTS5 → no duplicated text)
-- =====================================================================================

-- Contentless indexes (the text lives in the real tables; edition_verse is WITHOUT ROWID).
-- The build fills these after ingest; queries join back on the UNINDEXED key columns.
CREATE VIRTUAL TABLE fts_verse   USING fts5(text, edition_id UNINDEXED, vkey UNINDEXED,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE fts_work    USING fts5(title, text, edition_id UNINDEXED, ord UNINDEXED,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE fts_comment USING fts5(text, entry_id UNINDEXED,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE fts_lexicon USING fts5(lemma, translit, gloss, body, lemma_id UNINDEXED, lexicon_id UNINDEXED,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE fts_entity  USING fts5(name, alt_names, summary, entity_type UNINDEXED, entity_id UNINDEXED,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

-- =====================================================================================
-- §14  CONVENIENCE VIEWS
-- =====================================================================================

-- Unified timeline: every dated thing with its display title.
CREATE VIEW timeline AS
SELECT d.*, COALESCE(e.title, p.name, w.title, m.name, b.name, pr.name, cl.name, oh.office) AS title
FROM dating d
LEFT JOIN event e          ON d.entity_type='event'          AND e.id=d.entity_id
LEFT JOIN person p         ON d.entity_type='person'         AND p.id=d.entity_id
LEFT JOIN work w           ON d.entity_type='work'           AND w.id=d.entity_id
LEFT JOIN manuscript m     ON d.entity_type='manuscript'     AND m.id=d.entity_id
LEFT JOIN book b           ON d.entity_type='book'           AND b.osis=d.entity_id
LEFT JOIN period pr        ON d.entity_type='period'         AND pr.id=d.entity_id
LEFT JOIN canon_list cl    ON d.entity_type='canon_list'     AND cl.id=d.entity_id
LEFT JOIN office_holding oh ON d.entity_type='office_holding' AND oh.id=d.entity_id;

-- Everything that "witnesses" to a verse, for the witness timeline (manuscripts + citations).
CREATE VIEW verse_witness AS
SELECT c.start_vkey, c.end_vkey, 'citation' AS type, c.work_id AS id, c.year AS year_from, c.year AS year_to,
       c.reading AS detail
FROM citation c
UNION ALL
SELECT mc.start_vkey, mc.end_vkey, 'manuscript', m.id, m.date_from, m.date_to, m.date_label
FROM manuscript_coverage mc JOIN manuscript m ON m.id = mc.manuscript_id;

-- Registry of every named item with its URI (verses are addressed as verse:<osis> and not listed).
-- Used for universal search, link resolution, and grounding AI answers in real entities.
CREATE VIEW entity AS
SELECT 'person:' || id AS uri, 'person' AS type, id, name AS title, summary FROM person
UNION ALL SELECT 'place:' || id, 'place', id, name, summary FROM place
UNION ALL SELECT 'event:' || id, 'event', id, title, description FROM event
UNION ALL SELECT 'work:' || id, 'work', id, title, summary FROM work
UNION ALL SELECT 'ms:' || id, 'manuscript', id, COALESCE(name, sigla, id), contents FROM manuscript
UNION ALL SELECT 'lemma:' || id, 'lemma', id, lemma, gloss FROM lemma
UNION ALL SELECT 'edition:' || id, 'edition', id, title, description FROM edition
UNION ALL SELECT 'book:' || osis, 'book', osis, name, NULL FROM book
UNION ALL SELECT 'topic:' || id, 'topic', id, name, NULL FROM topic
UNION ALL SELECT 'period:' || id, 'period', id, name, description FROM period
UNION ALL SELECT 'canon:' || id, 'canon_list', id, name, description FROM canon_list
UNION ALL SELECT 'commentary:' || id, 'commentary', id, title, NULL FROM commentary
UNION ALL SELECT 'media:' || id, 'media', id, title, NULL FROM media;
