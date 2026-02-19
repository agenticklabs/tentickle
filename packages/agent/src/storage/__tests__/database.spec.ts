import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../database.js";

const TEST_DIR = join(tmpdir(), `tentickle-db-test-${process.pid}`);

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function getVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ==========================================================================
// Fresh database
// ==========================================================================

describe("runMigrations", () => {
  it("starts at user_version 0", () => {
    const db = freshDb();
    expect(getVersion(db)).toBe(0);
    db.close();
  });

  it("advances user_version to 1 after running migrations", () => {
    const db = freshDb();
    runMigrations(db);
    expect(getVersion(db)).toBe(1);
    db.close();
  });

  it("is idempotent — running twice doesn't fail", () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    expect(getVersion(db)).toBe(1);
    db.close();
  });

  it("creates all 11 tables", () => {
    const db = freshDb();
    runMigrations(db);
    const tables = tableNames(db);
    expect(tables).toContain("entities");
    expect(tables).toContain("entity_relationships");
    expect(tables).toContain("sessions");
    expect(tables).toContain("session_participants");
    expect(tables).toContain("executions");
    expect(tables).toContain("ticks");
    expect(tables).toContain("messages");
    expect(tables).toContain("content_blocks");
    expect(tables).toContain("media");
    expect(tables).toContain("knowledge");
    expect(tables).toContain("session_snapshots");
    expect(tables.length).toBeGreaterThanOrEqual(11);
    // Verify removed tables are gone
    expect(tables).not.toContain("session_state");
    expect(tables).not.toContain("session_data_cache");
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = freshDb();
    runMigrations(db);
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
    runMigrations(db);
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
    runMigrations(db);
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
    runMigrations(db);
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
    runMigrations(db);
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
    runMigrations(db);
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
    runMigrations(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");

    // Inserting a message with a non-existent execution_id should fail
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
    runMigrations(db);
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");

    // null execution_id should be fine (fallback/restored entries)
    db.prepare(
      "INSERT INTO messages (id, session_id, execution_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("m1", "s1", null, "user", 0, 0);

    const count = (db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
    expect(count).toBe(1);
    db.close();
  });

  it("rolls back on failed migration — version stays", () => {
    const db = freshDb();
    const version = getVersion(db);
    expect(version).toBe(0);
    expect(() => {
      db.exec("BEGIN");
      try {
        db.exec("INVALID SQL GIBBERISH;");
        db.exec("PRAGMA user_version = 1");
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }).toThrow(/INVALID/i);
    expect(getVersion(db)).toBe(0);
    db.close();
  });
});

// ==========================================================================
// openDatabase (integration — tests the full init path)
// ==========================================================================

describe("openDatabase", () => {
  it("creates a DB file with WAL mode and migrations applied", async () => {
    const { openDatabase } = await import("../database.js");
    const dbPath = join(TEST_DIR, "test.db");
    const db = await openDatabase(dbPath);

    expect(getVersion(db)).toBe(1);

    // WAL mode check
    const walResult = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(walResult.journal_mode).toBe("wal");

    // Foreign keys check
    const fkResult = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(fkResult.foreign_keys).toBe(1);

    const tables = tableNames(db);
    expect(tables.length).toBeGreaterThanOrEqual(11);

    db.close();
  });
});
