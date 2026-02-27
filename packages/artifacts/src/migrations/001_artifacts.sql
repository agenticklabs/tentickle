-- Tentickle artifacts — named, typed worker outputs

CREATE TABLE artifacts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text',
  content    TEXT NOT NULL,
  summary    TEXT,
  metadata   TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_artifacts_session ON artifacts(session_id);
CREATE INDEX idx_artifacts_name ON artifacts(name);
CREATE INDEX idx_artifacts_type ON artifacts(type);
