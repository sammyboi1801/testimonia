-- =====================================================================================
--  TESTIMONIA — AI database schema  (ai.db: optional, derived, rebuildable)
--
--  Holds everything model-dependent so core.db stays lean and model-agnostic:
--    * chunks of text prepared for retrieval (scripture windows, work sections, commentary,
--      lexicon articles, the user's own notes)
--    * embeddings per (chunk, model) — several models can coexist
--    * a cache of AI outputs (summaries, translations, explanations)
--    * AI *proposals* (allusions, links, datings…) awaiting human review
--
--  Everything points back to real content through URIs (see core.sql header), so an AI answer
--  can always cite exactly which verse, section or note it used.
--  Deleting ai.db loses nothing irreplaceable except unreviewed proposals.
-- =====================================================================================

PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;   -- ai schema version (ai.db is rebuilt on mismatch)

CREATE TABLE ai_meta (key TEXT PRIMARY KEY, value TEXT) STRICT;   -- core build id this ai.db was derived from, etc.

CREATE TABLE embedding_model (
  id          TEXT PRIMARY KEY,            -- 'bge-m3@1', 'voyage-3@2025-01', 'local-minilm@1'
  provider    TEXT NOT NULL,               -- 'local','voyage','openai','cohere'…
  name        TEXT NOT NULL,
  dim         INTEGER NOT NULL CHECK (dim > 0),
  distance    TEXT NOT NULL DEFAULT 'cosine' CHECK (distance IN ('cosine','dot','l2')),
  normalized  INTEGER NOT NULL DEFAULT 1 CHECK (normalized IN (0, 1)),
  languages   TEXT,                        -- JSON list: ["en","grc","hbo","la"]
  created_at  TEXT
) STRICT;

-- A retrievable unit of text. `uri` says where it came from; filters make retrieval
-- chronology-aware (e.g. "only sources before AD 325") and scripture-aware.
CREATE TABLE chunk (
  id           INTEGER PRIMARY KEY,
  uri          TEXT NOT NULL,              -- 'verse:John.1.1-John.1.18', 'section:irenaeus.haer@anf#3.11.6',
                                           -- 'commentary:matthew-henry#43001001', 'lexicon:bdb#H0430', 'note:<uuid>'
  kind         TEXT NOT NULL CHECK (kind IN ('scripture','work-section','commentary','lexicon','entity','note','other')),
  origin       TEXT NOT NULL CHECK (origin IN ('core','user')),
  lang         TEXT,                       -- 'eng','grc','hbo','lat'
  start_vkey   INTEGER, end_vkey INTEGER,  -- scripture the chunk is about / covers
  year_from    INTEGER, year_to INTEGER,   -- date of the text (astronomical) → era filters
  author_uri   TEXT,                       -- 'person:origen'
  title        TEXT,                       -- display label for citations
  text         TEXT NOT NULL,
  content_hash TEXT NOT NULL,              -- sha256(text): re-embed only when the content changed
  token_count  INTEGER,
  CHECK (start_vkey IS NULL OR end_vkey IS NULL OR start_vkey <= end_vkey),
  UNIQUE (uri, content_hash)
) STRICT;
CREATE INDEX chunk_uri   ON chunk(uri);
CREATE INDEX chunk_range ON chunk(start_vkey, end_vkey);
CREATE INDEX chunk_year  ON chunk(year_from);

CREATE TABLE embedding (
  chunk_id    INTEGER NOT NULL REFERENCES chunk(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL REFERENCES embedding_model(id),
  vector      BLOB NOT NULL,               -- float32 little-endian, length = dim * 4
  created_at  TEXT,
  CHECK (length(vector) % 4 = 0),
  PRIMARY KEY (chunk_id, model_id)
) STRICT, WITHOUT ROWID;
-- Approximate-nearest-neighbour indexes are optional and created at runtime when the
-- sqlite-vec extension is available:  CREATE VIRTUAL TABLE vec_<model> USING vec0(embedding float[<dim>]);
-- Without it, search falls back to brute-force cosine over `embedding` (fine up to ~1M chunks).

-- Keyword index over the same chunks for hybrid (BM25 + vector) retrieval.
CREATE VIRTUAL TABLE fts_chunk USING fts5(title, text, chunk_id UNINDEXED,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

-- Cached model outputs. key = sha256(task, model, prompt_version, inputs).
CREATE TABLE ai_cache (
  key            TEXT PRIMARY KEY,
  task           TEXT NOT NULL,            -- 'summarize-section','explain-variant','translate-verse','word-study'
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_uris     TEXT,                     -- JSON list of URIs the output is based on
  output         TEXT NOT NULL,            -- JSON or text
  created_at     TEXT NOT NULL,
  expires_at     TEXT
) STRICT;
CREATE INDEX ai_cache_task ON ai_cache(task);

-- A batch AI job (e.g. "tag allusions in ANF vol. 1 with model X, prompt v3").
CREATE TABLE ai_run (
  id             TEXT PRIMARY KEY,         -- uuid
  task           TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  params         TEXT,                     -- JSON
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  stats          TEXT                      -- JSON: items processed, cost, errors
) STRICT;

-- AI proposals awaiting human review. Accepted proposals can be exported to curated/ (and so
-- contributed upstream into core.db under a 'machine' or 'curated' source); rejected ones are kept
-- so the same suggestion is not re-proposed.
CREATE TABLE ai_proposal (
  id          INTEGER PRIMARY KEY,
  run_id      TEXT REFERENCES ai_run(id),
  kind        TEXT NOT NULL CHECK (kind IN ('link','citation','dating','attr','variant-note','summary','other')),
  src         TEXT NOT NULL,               -- URI
  rel         TEXT,                        -- for links: 'alludes_to','quotes','responds_to'…
  dst         TEXT,                        -- URI
  value       TEXT,                        -- JSON payload (e.g. a proposed date window)
  confidence  REAL CHECK (confidence BETWEEN 0 AND 1),
  rationale   TEXT,                        -- the model's explanation, shown to the reviewer
  evidence    TEXT,                        -- JSON list of URIs/quotes supporting it
  status      TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','accepted','rejected','exported')),
  reviewed_at TEXT,
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX ai_proposal_src    ON ai_proposal(src);
CREATE INDEX ai_proposal_status ON ai_proposal(status, kind);
