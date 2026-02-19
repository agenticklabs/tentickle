-- Tentickle normalized storage — initial schema
-- 11 tables: 4 domain (entities, entity_relationships, knowledge, messages)
--            7 infrastructure (sessions, session_participants, session_snapshots,
--                              executions, ticks, content_blocks, media)

-- ==========================================================================
-- Entities — people, models, agents, orgs, projects, things
-- ==========================================================================

CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  summary     TEXT,
  is_owner    INTEGER NOT NULL DEFAULT 0,
  metadata    TEXT DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_entities_type ON entities(type);

-- ==========================================================================
-- Entity Relationships — typed directed edges (the knowledge graph)
-- ==========================================================================

CREATE TABLE entity_relationships (
  source_entity_id  TEXT NOT NULL REFERENCES entities(id),
  target_entity_id  TEXT NOT NULL REFERENCES entities(id),
  relationship      TEXT NOT NULL,
  confidence        REAL DEFAULT 1.0,
  source_session_id TEXT REFERENCES sessions(id),
  metadata          TEXT DEFAULT '{}',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  PRIMARY KEY (source_entity_id, target_entity_id, relationship)
);

CREATE INDEX idx_entity_rels_source ON entity_relationships(source_entity_id);
CREATE INDEX idx_entity_rels_target ON entity_relationships(target_entity_id);

-- ==========================================================================
-- Sessions — conversation contexts
-- ==========================================================================

CREATE TABLE sessions (
  id                    TEXT PRIMARY KEY,
  parent_session_id     TEXT REFERENCES sessions(id),
  session_type          TEXT NOT NULL DEFAULT 'chat'
                        CHECK (session_type IN ('chat', 'fork', 'spawn', 'system')),
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

CREATE INDEX idx_sessions_parent  ON sessions(parent_session_id);
CREATE INDEX idx_sessions_status  ON sessions(status);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

-- ==========================================================================
-- Session Participants — which entities are in which sessions
-- ==========================================================================

CREATE TABLE session_participants (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'member', 'observer')),
  joined_at   INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  left_at     INTEGER,
  PRIMARY KEY (session_id, entity_id)
);

-- ==========================================================================
-- Executions — tracks each user interaction / heartbeat / dispatch
-- ==========================================================================

CREATE TABLE executions (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL DEFAULT 'unknown',
  status        TEXT NOT NULL DEFAULT 'running',
  tick_count    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  completed_at  INTEGER
);

CREATE INDEX idx_executions_session ON executions(session_id, started_at DESC);

-- ==========================================================================
-- Ticks — per-tick metrics with model + usage for cost tracking
-- ==========================================================================

CREATE TABLE ticks (
  execution_id  TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  tick_number   INTEGER NOT NULL,
  model         TEXT,
  usage         TEXT,
  stop_reason   TEXT,
  started_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  completed_at  INTEGER,
  PRIMARY KEY (execution_id, tick_number)
);

-- ==========================================================================
-- Messages — timeline entries
-- ==========================================================================

CREATE TABLE messages (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  entity_id         TEXT REFERENCES entities(id),
  execution_id      TEXT REFERENCES executions(id),
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool', 'event')),
  tick              INTEGER NOT NULL,
  sequence_in_tick  INTEGER NOT NULL,
  text_preview      TEXT,
  visibility        TEXT,
  tags              TEXT,
  tokens            INTEGER,
  metadata          TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_messages_session   ON messages(session_id, tick, sequence_in_tick);
CREATE INDEX idx_messages_entity    ON messages(entity_id);
CREATE INDEX idx_messages_execution ON messages(execution_id);

-- ==========================================================================
-- Content Blocks — decomposed message content
-- ==========================================================================

CREATE TABLE content_blocks (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  block_type    TEXT NOT NULL,
  text_content  TEXT,
  content_json  TEXT NOT NULL,
  metadata      TEXT
);

CREATE INDEX idx_blocks_message ON content_blocks(message_id, position);

-- ==========================================================================
-- Media — deduplicated files
-- ==========================================================================

CREATE TABLE media (
  id            TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL UNIQUE,
  filename      TEXT,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  dir_path      TEXT NOT NULL,
  entity_id     TEXT REFERENCES entities(id),
  session_id    TEXT REFERENCES sessions(id),
  description   TEXT,
  transcript    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_media_hash   ON media(content_hash);
CREATE INDEX idx_media_entity ON media(entity_id);

-- ==========================================================================
-- Knowledge — append-only knowledge log
-- ==========================================================================

CREATE TABLE knowledge (
  id                TEXT PRIMARY KEY,
  entity_id         TEXT REFERENCES entities(id),
  lineage_id        TEXT,
  topic             TEXT NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  confidence        REAL DEFAULT 1.0,
  source_session_id TEXT REFERENCES sessions(id),
  source_message_id TEXT REFERENCES messages(id),
  access_count      INTEGER DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_knowledge_entity  ON knowledge(entity_id);
CREATE INDEX idx_knowledge_topic   ON knowledge(topic);
CREATE INDEX idx_knowledge_lineage ON knowledge(lineage_id, created_at DESC);
CREATE INDEX idx_knowledge_created ON knowledge(created_at DESC);

-- ==========================================================================
-- Session Snapshots — flexible KV for comState and other session data
-- ==========================================================================

CREATE TABLE session_snapshots (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  PRIMARY KEY (session_id, key)
);
