-- Tentickle memory — cross-session knowledge store (FTS5 keyword search)

-- ==========================================================================
-- Memories — cross-session knowledge store
-- ==========================================================================

CREATE TABLE IF NOT EXISTS memories (
  id                TEXT PRIMARY KEY,
  namespace         TEXT NOT NULL DEFAULT 'default',
  content           TEXT NOT NULL,
  topic             TEXT,
  importance        REAL DEFAULT 0.5,
  metadata          TEXT,
  source_session_id TEXT,
  access_count      INTEGER NOT NULL DEFAULT 0,
  last_accessed_at  INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(namespace, topic);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

-- ==========================================================================
-- FTS5 virtual table for keyword search
-- ==========================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  topic,
  content='memories',
  content_rowid='rowid'
);

-- Triggers to keep FTS index in sync with memories table

DROP TRIGGER IF EXISTS memories_ai;
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, topic)
  VALUES (new.rowid, new.content, new.topic);
END;

DROP TRIGGER IF EXISTS memories_ad;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, topic)
  VALUES ('delete', old.rowid, old.content, old.topic);
END;

DROP TRIGGER IF EXISTS memories_au;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, topic)
  VALUES ('delete', old.rowid, old.content, old.topic);
  INSERT INTO memories_fts(rowid, content, topic)
  VALUES (new.rowid, new.content, new.topic);
END;
