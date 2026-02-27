import { randomUUID } from "node:crypto";
import type { ArtifactInput, ArtifactEntry } from "./types.js";

type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>;

interface ArtifactRow {
  id: string;
  name: string;
  type: string;
  content: string;
  summary: string | null;
  metadata: string | null;
  session_id: string | null;
  created_at: number;
  updated_at: number;
}

function row<T>(result: unknown): T | undefined {
  return result as T | undefined;
}

function rows<T>(result: unknown): T[] {
  return result as T[];
}

function rowToEntry(r: ArtifactRow): ArtifactEntry {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    content: r.content,
    summary: r.summary,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    sessionId: r.session_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class ArtifactStore {
  private db: DatabaseSync;
  private destroyed = false;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static create(db: DatabaseSync): ArtifactStore {
    return new ArtifactStore(db);
  }

  // ==========================================================================
  // Core CRUD
  // ==========================================================================

  store(input: ArtifactInput, sessionId?: string): ArtifactEntry {
    this.assertAlive();
    const id = randomUUID();
    const now = Date.now();
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

    this.db
      .prepare(
        `INSERT INTO artifacts (id, name, type, content, summary, metadata, session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.type,
        input.content,
        input.summary ?? null,
        metadata,
        sessionId ?? null,
        now,
        now,
      );

    return {
      id,
      name: input.name,
      type: input.type,
      content: input.content,
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
      sessionId: sessionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  get(id: string): ArtifactEntry | null {
    this.assertAlive();
    const r = row<ArtifactRow>(this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id));
    return r ? rowToEntry(r) : null;
  }

  getByName(name: string, sessionId?: string): ArtifactEntry | null {
    this.assertAlive();
    if (sessionId != null) {
      const r = row<ArtifactRow>(
        this.db
          .prepare(
            "SELECT * FROM artifacts WHERE name = ? AND session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
          )
          .get(name, sessionId),
      );
      return r ? rowToEntry(r) : null;
    }
    const r = row<ArtifactRow>(
      this.db
        .prepare(
          "SELECT * FROM artifacts WHERE name = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .get(name),
    );
    return r ? rowToEntry(r) : null;
  }

  update(id: string, patch: Partial<ArtifactInput>): ArtifactEntry | null {
    this.assertAlive();
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    const name = patch.name ?? existing.name;
    const type = patch.type ?? existing.type;
    const content = patch.content ?? existing.content;
    const summary = patch.summary !== undefined ? (patch.summary ?? null) : existing.summary;
    const metadata =
      patch.metadata !== undefined
        ? patch.metadata
          ? JSON.stringify(patch.metadata)
          : null
        : existing.metadata
          ? JSON.stringify(existing.metadata)
          : null;

    this.db
      .prepare(
        `UPDATE artifacts SET name = ?, type = ?, content = ?, summary = ?, metadata = ?, updated_at = ? WHERE id = ?`,
      )
      .run(name, type, content, summary, metadata, now, id);

    return {
      ...existing,
      name,
      type,
      content,
      summary,
      metadata: patch.metadata !== undefined ? (patch.metadata ?? null) : existing.metadata,
      updatedAt: now,
    };
  }

  delete(id: string): boolean {
    this.assertAlive();
    const result = this.db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  list(sessionId?: string): ArtifactEntry[] {
    this.assertAlive();
    if (sessionId != null) {
      return rows<ArtifactRow>(
        this.db
          .prepare(
            "SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at DESC, rowid DESC",
          )
          .all(sessionId),
      ).map(rowToEntry);
    }
    return rows<ArtifactRow>(
      this.db.prepare("SELECT * FROM artifacts ORDER BY created_at DESC, rowid DESC").all(),
    ).map(rowToEntry);
  }

  listByType(type: string, sessionId?: string): ArtifactEntry[] {
    this.assertAlive();
    if (sessionId != null) {
      return rows<ArtifactRow>(
        this.db
          .prepare(
            "SELECT * FROM artifacts WHERE type = ? AND session_id = ? ORDER BY created_at DESC, rowid DESC",
          )
          .all(type, sessionId),
      ).map(rowToEntry);
    }
    return rows<ArtifactRow>(
      this.db
        .prepare("SELECT * FROM artifacts WHERE type = ? ORDER BY created_at DESC, rowid DESC")
        .all(type),
    ).map(rowToEntry);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  destroy(): void {
    this.destroyed = true;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("ArtifactStore has been destroyed");
    }
  }
}
