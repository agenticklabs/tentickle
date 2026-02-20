import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureStorageSchema } from "../schema.js";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

function getSchemaVersion(db: DatabaseSync, pkg: string): number {
  try {
    const r = db.prepare("SELECT version FROM _schema_versions WHERE package = ?").get(pkg) as
      | { version: number }
      | undefined;
    return r ? r.version : 0;
  } catch {
    return 0;
  }
}

// ==========================================================================
// ensureStorageSchema
// ==========================================================================

describe("ensureStorageSchema", () => {
  it("creates expected tables", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    const tables = tableNames(db);
    expect(tables).toContain("entities");
    expect(tables).toContain("sessions");
    expect(tables).toContain("session_participants");
    expect(tables).toContain("executions");
    expect(tables).toContain("ticks");
    expect(tables).toContain("messages");
    expect(tables).toContain("content_blocks");
    expect(tables).toContain("media");
    expect(tables).toContain("session_snapshots");
    expect(tables).toContain("_schema_versions");
    // No memory tables
    expect(tables).not.toContain("memories");
    expect(tables).not.toContain("memories_fts");
    // No legacy tables
    expect(tables).not.toContain("entity_relationships");
    expect(tables).not.toContain("knowledge");
    db.close();
  });

  it("sets storage version to 1 in _schema_versions", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    expect(getSchemaVersion(db, "storage")).toBe(1);
    db.close();
  });

  it("is idempotent — running twice doesn't fail", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    ensureStorageSchema(db);
    expect(getSchemaVersion(db, "storage")).toBe(1);
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO messages (id, session_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?)",
        )
        .run("m1", "nonexistent-session", "user", 0, 0),
    ).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });

  it("cascades deletes from sessions to messages", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");
    db.prepare(
      "INSERT INTO messages (id, session_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?)",
    ).run("m1", "s1", "user", 0, 0);

    const before = (db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
    expect(before).toBe(1);

    db.prepare("DELETE FROM sessions WHERE id = ?").run("s1");

    const after = (db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
    expect(after).toBe(0);
    db.close();
  });

  it("cascades deletes from messages to content_blocks", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");
    db.prepare(
      "INSERT INTO messages (id, session_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?)",
    ).run("m1", "s1", "user", 0, 0);
    db.prepare(
      "INSERT INTO content_blocks (id, message_id, position, block_type, content_json) VALUES (?, ?, ?, ?, ?)",
    ).run("b1", "m1", 0, "text", '{"type":"text","text":"hi"}');

    db.prepare("DELETE FROM messages WHERE id = ?").run("m1");

    const count = (db.prepare("SELECT count(*) as c FROM content_blocks").get() as { c: number }).c;
    expect(count).toBe(0);
    db.close();
  });

  it("cascades deletes from sessions to executions and ticks", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");
    db.prepare(
      "INSERT INTO executions (id, session_id, trigger_type, status) VALUES (?, ?, ?, ?)",
    ).run("e1", "s1", "send", "running");
    db.prepare("INSERT INTO ticks (execution_id, tick_number) VALUES (?, ?)").run("e1", 0);

    db.prepare("DELETE FROM sessions WHERE id = ?").run("s1");

    const execCount = (db.prepare("SELECT count(*) as c FROM executions").get() as { c: number }).c;
    const tickCount = (db.prepare("SELECT count(*) as c FROM ticks").get() as { c: number }).c;
    expect(execCount).toBe(0);
    expect(tickCount).toBe(0);
    db.close();
  });

  it("cascades deletes from executions to ticks", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");
    db.prepare(
      "INSERT INTO executions (id, session_id, trigger_type, status) VALUES (?, ?, ?, ?)",
    ).run("e1", "s1", "send", "running");
    db.prepare("INSERT INTO ticks (execution_id, tick_number) VALUES (?, ?)").run("e1", 0);
    db.prepare("INSERT INTO ticks (execution_id, tick_number) VALUES (?, ?)").run("e1", 1);

    db.prepare("DELETE FROM executions WHERE id = ?").run("e1");

    const tickCount = (db.prepare("SELECT count(*) as c FROM ticks").get() as { c: number }).c;
    expect(tickCount).toBe(0);
    db.close();
  });

  it("cascades deletes from sessions to session_snapshots", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");
    db.prepare("INSERT INTO session_snapshots (session_id, key, value) VALUES (?, ?, ?)").run(
      "s1",
      "com_state",
      "{}",
    );

    db.prepare("DELETE FROM sessions WHERE id = ?").run("s1");

    const count = (db.prepare("SELECT count(*) as c FROM session_snapshots").get() as { c: number })
      .c;
    expect(count).toBe(0);
    db.close();
  });

  it("enforces execution_id FK on messages", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");

    expect(() =>
      db
        .prepare(
          "INSERT INTO messages (id, session_id, execution_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("m1", "s1", "nonexistent-execution", "user", 0, 0),
    ).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });

  it("allows null execution_id on messages", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");

    db.prepare(
      "INSERT INTO messages (id, session_id, execution_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("m1", "s1", null, "user", 0, 0);

    const count = (db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
    expect(count).toBe(1);
    db.close();
  });

  it("drops legacy tables if they exist", () => {
    const db = freshDb();
    // Simulate old schema with legacy tables
    db.exec("CREATE TABLE entity_relationships (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE knowledge (id TEXT PRIMARY KEY)");

    ensureStorageSchema(db);

    const tables = tableNames(db);
    expect(tables).not.toContain("entity_relationships");
    expect(tables).not.toContain("knowledge");
    db.close();
  });

  it("works alongside memory schema versions", () => {
    const db = freshDb();
    ensureStorageSchema(db);
    // Simulate memory package setting its own version
    db.prepare("INSERT OR REPLACE INTO _schema_versions (package, version) VALUES (?, ?)").run(
      "memory",
      1,
    );

    expect(getSchemaVersion(db, "storage")).toBe(1);
    expect(getSchemaVersion(db, "memory")).toBe(1);
    db.close();
  });
});
