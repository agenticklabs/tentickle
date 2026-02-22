-- Migration 002: Add delegation/supervision session types
-- SQLite cannot ALTER CHECK constraints — must recreate the table.
--
-- IMPORTANT: This migration MUST run with PRAGMA foreign_keys = OFF
-- to prevent cascade-deletes when the old sessions table is dropped.
-- The calling code (schema.ts) handles this.

CREATE TABLE IF NOT EXISTS sessions_new (
  id                    TEXT PRIMARY KEY,
  parent_session_id     TEXT REFERENCES sessions_new(id),
  session_type          TEXT NOT NULL DEFAULT 'chat'
                        CHECK (session_type IN ('chat', 'fork', 'spawn', 'system', 'delegation', 'supervision')),
  fork_after_message_id TEXT REFERENCES messages(id),
  title                 TEXT,
  workspace             TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'completed', 'failed', 'archived')),
  owner_entity_id       TEXT REFERENCES entities(id),
  tick                  INTEGER NOT NULL DEFAULT 0,
  version               TEXT NOT NULL DEFAULT '1.0',
  created_at            INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

INSERT INTO sessions_new (id, parent_session_id, session_type, fork_after_message_id, title, workspace, status, owner_entity_id, tick, version, created_at, updated_at)
SELECT id, parent_session_id, session_type, fork_after_message_id, title, workspace, status, owner_entity_id, tick, version, created_at, updated_at
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

-- Re-create indexes
CREATE INDEX IF NOT EXISTS idx_sessions_parent  ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

-- Index for delegation queries: find active delegations by parent
CREATE INDEX IF NOT EXISTS idx_sessions_delegation
  ON sessions(parent_session_id, session_type, status);
