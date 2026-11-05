-- =====================================================================================
--  TESTIMONIA — user database, migration 0001 (baseline)
--
--  user.db holds everything the reader creates. It is NEVER touched by a core rebuild.
--  Note *bodies* live as markdown files in notes/ (Obsidian-compatible); this DB indexes them.
--
--  Rules (all user tables):
--   * References to core data are URIs ('verse:John.1.18', 'person:irenaeus', 'ms:GA:P66'),
--     never core rowids — so a rebuilt core.db never breaks user data.
--   * Rows have a uuid `id`, `created_at`, `updated_at` (ISO-8601 UTC) and a `deleted` tombstone,
--     so devices can later be synced (last-write-wins per row) without a schema change.
--   * Applied by testimonia.db.migrate_user(). Once released, never edit — add NNNN_*.sql.
-- =====================================================================================

CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT) STRICT;  -- JSON values

-- Markdown notes on disk, indexed. A note may anchor to any item (or none).
CREATE TABLE note (
  id          TEXT PRIMARY KEY,            -- uuid (also written into the note's front-matter)
  path        TEXT NOT NULL UNIQUE,        -- relative to notes/, e.g. 'John/John.1.18 only begotten.md'
  title       TEXT,
  anchor      TEXT,                        -- URI: 'verse:John.1.18-John.1.20', 'section:irenaeus.haer@anf#3.11.6'
  start_vkey  INTEGER, end_vkey INTEGER,   -- denormalised from verse anchors (fast lookups)
  tags        TEXT,                        -- JSON array
  file_mtime  REAL,                        -- detects edits made in Obsidian
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  CHECK (start_vkey IS NULL OR end_vkey IS NULL OR start_vkey <= end_vkey)
) STRICT;
CREATE INDEX note_range  ON note(start_vkey, end_vkey);
CREATE INDEX note_anchor ON note(anchor);

-- Your own translation, verse by verse (replaces BTB pericope note lines). Exportable to markdown.
CREATE TABLE my_translation (
  id          TEXT PRIMARY KEY,            -- uuid
  project     TEXT NOT NULL DEFAULT 'default',
  vkey        INTEGER NOT NULL,
  text        TEXT NOT NULL,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','final')),
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  UNIQUE (project, vkey)
) STRICT;

CREATE TABLE highlight (
  id          TEXT PRIMARY KEY,            -- uuid
  target      TEXT NOT NULL,               -- URI of the text: 'edition:kjv', 'section:irenaeus.haer@anf#3.11.6'
  start_vkey  INTEGER, end_vkey INTEGER,   -- for Bible text
  char_start  INTEGER, char_end INTEGER,   -- optional word-level precision
  style       TEXT NOT NULL,               -- 'yellow','underline','variant','question'…
  label       TEXT,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE INDEX highlight_range ON highlight(start_vkey);

-- Tag anything (verses, fathers, manuscripts, notes…)
CREATE TABLE tagging (
  id          TEXT PRIMARY KEY,
  uri         TEXT NOT NULL,
  tag         TEXT NOT NULL,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  UNIQUE (uri, tag)
) STRICT;
CREATE INDEX tagging_tag ON tagging(tag);

-- Named lists: passage sets, study guides, sermon/lesson outlines, reading lists.
CREATE TABLE collection (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,                        -- 'passages','study','outline','reading-list'
  description TEXT,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE TABLE collection_item (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collection(id),
  ord           REAL NOT NULL,             -- REAL allows inserting between items without renumbering
  uri           TEXT NOT NULL,             -- any item
  comment       TEXT,
  created_at    TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE INDEX collection_item_coll ON collection_item(collection_id, ord);

CREATE TABLE reading_plan (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,                        -- 'canonical','chronological','fathers','custom'
  definition  TEXT NOT NULL CHECK (json_valid(definition)),  -- JSON: days → list of URIs
  started_on  TEXT,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE TABLE reading_progress (
  plan_id     TEXT NOT NULL REFERENCES reading_plan(id),
  day         INTEGER NOT NULL CHECK (day >= 1),
  done_at     TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (plan_id, day)
) STRICT;

CREATE TABLE history (                     -- navigation history (local only, not synced)
  id          INTEGER PRIMARY KEY,
  uri         TEXT NOT NULL,
  visited_at  TEXT NOT NULL
) STRICT;

CREATE TABLE workspace (                   -- saved panel layouts (linked panes, guides)
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  layout      TEXT NOT NULL CHECK (json_valid(layout)),
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;

-- Cache for live scholarly APIs (OpenAlex, Crossref, DOAJ, Internet Archive) — avoids re-querying.
CREATE TABLE api_cache (
  provider    TEXT NOT NULL,
  query       TEXT NOT NULL,
  response    TEXT NOT NULL,               -- JSON
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (provider, query)
) STRICT;

CREATE VIRTUAL TABLE fts_note USING fts5(title, body, note_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2');
