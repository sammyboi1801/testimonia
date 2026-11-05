-- =====================================================================================
--  TESTIMONIA — user database schema
--  user.db holds everything the reader creates. It is NEVER touched by a core rebuild.
--  Note *bodies* live as markdown files in notes/ (Obsidian-compatible); this DB indexes them.
--  References to core data use stable keys only (vkey ranges, entity ids), never core rowids.
-- =====================================================================================

-- Migration 0001. Applied by testimonia.db.migrate_user(); never edit after release — add 0002_*.sql instead.

CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT) STRICT;   -- JSON values

-- Markdown notes on disk, indexed. One note may anchor to a verse range, an entity, or nothing.
CREATE TABLE IF NOT EXISTS note (
  id          TEXT PRIMARY KEY,            -- uuid
  path        TEXT NOT NULL UNIQUE,        -- relative to notes/, e.g. 'John/John.1.18 only begotten.md'
  title       TEXT,
  anchor_type TEXT,                        -- 'verse-range','work-section','person','manuscript','topic', NULL
  anchor_id   TEXT,                        -- 'start_vkey-end_vkey' | 'irenaeus.haer@anf#3.11.6' | 'GA:P66'
  start_vkey  INTEGER, end_vkey INTEGER,   -- filled for verse anchors (fast lookups)
  tags        TEXT,                        -- JSON array
  created_at  TEXT, updated_at TEXT,
  file_mtime  REAL                         -- to detect edits made in Obsidian
) STRICT;
CREATE INDEX IF NOT EXISTS note_range ON note(start_vkey, end_vkey);

-- Your own translation, verse by verse (replaces BTB pericope note lines). Also exported to markdown.
CREATE TABLE IF NOT EXISTS my_translation (
  project     TEXT NOT NULL DEFAULT 'default',
  vkey        INTEGER NOT NULL,
  text        TEXT NOT NULL,
  notes       TEXT,
  status      TEXT,                        -- 'draft','review','final'
  updated_at  TEXT,
  PRIMARY KEY (project, vkey)
) STRICT;

CREATE TABLE IF NOT EXISTS highlight (
  id          INTEGER PRIMARY KEY,
  target      TEXT NOT NULL,               -- 'edition:kjv' | 'work:irenaeus.haer@anf'
  start_vkey  INTEGER, end_vkey INTEGER,   -- for Bible text
  section     TEXT,                        -- for works: section cite
  char_start  INTEGER, char_end INTEGER,   -- optional word-level precision
  style       TEXT NOT NULL,               -- 'yellow','underline','variant','question'…
  label       TEXT,
  created_at  TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS highlight_range ON highlight(start_vkey);

CREATE TABLE IF NOT EXISTS collection (     -- named passage lists / study sets / sermon outlines
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, description TEXT, created_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS collection_item (
  collection_id TEXT NOT NULL, ord INTEGER NOT NULL,
  item_type   TEXT NOT NULL,               -- 'verse-range','work-section','entity','note'
  item_id     TEXT NOT NULL,
  comment     TEXT,
  PRIMARY KEY (collection_id, ord)
) STRICT;

CREATE TABLE IF NOT EXISTS reading_plan (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT,      -- 'canonical','chronological','fathers','custom'
  definition TEXT NOT NULL,                                -- JSON list of days → readings
  started_on TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS reading_progress (
  plan_id TEXT NOT NULL, day INTEGER NOT NULL, done_at TEXT,
  PRIMARY KEY (plan_id, day)
) STRICT;

CREATE TABLE IF NOT EXISTS history (        -- navigation history / recently viewed
  id INTEGER PRIMARY KEY, target TEXT NOT NULL, visited_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS workspace (      -- saved panel layouts (linked panes, guides)
  id TEXT PRIMARY KEY, name TEXT NOT NULL, layout TEXT NOT NULL, updated_at TEXT
) STRICT;

-- Cache for live scholarly APIs (OpenAlex, Crossref, DOAJ, Internet Archive) — avoids re-querying.
CREATE TABLE IF NOT EXISTS api_cache (
  provider    TEXT NOT NULL,
  query       TEXT NOT NULL,
  response    TEXT NOT NULL,               -- JSON
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (provider, query)
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS fts_note USING fts5(title, body, note_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2');
