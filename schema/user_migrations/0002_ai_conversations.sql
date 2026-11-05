-- =====================================================================================
--  TESTIMONIA — user database, migration 0002: AI study assistant
--
--  Conversations with an AI assistant are user data (they can be meaningful study history),
--  so they live in user.db. Every assistant message records which sources it was given and
--  which it cited (as URIs), so answers stay checkable against the real texts.
-- =====================================================================================

CREATE TABLE ai_conversation (
  id          TEXT PRIMARY KEY,            -- uuid
  title       TEXT,
  anchor      TEXT,                        -- URI the conversation started from ('verse:John.1.18')
  settings    TEXT CHECK (settings IS NULL OR json_valid(settings)),
                                           -- JSON: era filter (e.g. pre-Nicene only), editions, model
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;

CREATE TABLE ai_message (
  id              TEXT PRIMARY KEY,        -- uuid
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id),
  seq             INTEGER NOT NULL CHECK (seq >= 1),
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content         TEXT NOT NULL,
  model           TEXT,                    -- assistant messages: model id + version
  context_uris    TEXT CHECK (context_uris IS NULL OR json_valid(context_uris)),
                                           -- JSON: URIs retrieved and given to the model
  citations       TEXT CHECK (citations IS NULL OR json_valid(citations)),
                                           -- JSON: [{"uri": "...", "quote": "..."}] cited in the answer
  tokens_in       INTEGER, tokens_out INTEGER,
  created_at      TEXT NOT NULL,
  UNIQUE (conversation_id, seq)
) STRICT;

CREATE TABLE ai_feedback (                 -- thumbs up/down + comments, to improve prompts/retrieval
  message_id  TEXT PRIMARY KEY REFERENCES ai_message(id),
  rating      INTEGER CHECK (rating IN (-1, 0, 1)),
  comment     TEXT,
  created_at  TEXT NOT NULL
) STRICT;
