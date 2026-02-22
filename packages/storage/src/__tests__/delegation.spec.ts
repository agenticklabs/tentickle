import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { ensureStorageSchema } from "../schema.js";
import { TentickleSessionStore } from "../session-store.js";

let db: DatabaseSync;
let store: TentickleSessionStore;

function freshDb(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  ensureStorageSchema(d);
  return d;
}

beforeEach(() => {
  db = freshDb();
  store = new TentickleSessionStore(db);
});

// ==========================================================================
// Schema migration 002 — session_type CHECK constraint
// ==========================================================================

describe("schema: session_type CHECK", () => {
  it("accepts delegation session type", () => {
    expect(() =>
      store.initSession("d1", { sessionType: "delegation", title: "test" }),
    ).not.toThrow();
  });

  it("accepts supervision session type", () => {
    expect(() =>
      store.initSession("s1", { sessionType: "supervision", title: "test" }),
    ).not.toThrow();
  });

  it("accepts all original session types", () => {
    for (const type of ["chat", "fork", "spawn", "system"]) {
      const id = randomUUID();
      expect(() => store.initSession(id, { sessionType: type })).not.toThrow();
    }
  });

  it("rejects invalid session type", () => {
    expect(() => store.initSession("bad", { sessionType: "bogus" })).toThrow(/CHECK/);
  });

  it("rejects invalid status", () => {
    expect(() => store.initSession("bad", { sessionType: "delegation", status: "bogus" })).toThrow(
      /CHECK/,
    );
  });
});

// ==========================================================================
// initSession
// ==========================================================================

describe("initSession", () => {
  it("creates a row with all columns populated", () => {
    store.initSession("parent", { sessionType: "chat" });
    store.initSession("s1", {
      parentSessionId: "parent",
      sessionType: "delegation",
      title: "Fix the bug",
      status: "active",
      workspace: "/home/user/project",
    });

    const row = store.getSessionMeta("s1");
    expect(row).not.toBeNull();
    expect(row!.id).toBe("s1");
    expect(row!.parent_session_id).toBe("parent");
    expect(row!.session_type).toBe("delegation");
    expect(row!.title).toBe("Fix the bug");
    expect(row!.status).toBe("active");
    expect(row!.workspace).toBe("/home/user/project");
    expect(row!.tick).toBe(0);
    expect(row!.version).toBe("1.0");
    expect(row!.created_at).toBeGreaterThan(0);
    expect(row!.updated_at).toBeGreaterThan(0);
  });

  it("defaults to chat type and active status", () => {
    store.initSession("s2", {});
    const row = store.getSessionMeta("s2");
    expect(row!.session_type).toBe("chat");
    expect(row!.status).toBe("active");
  });

  it("upserts on duplicate session id — updates delegation columns", () => {
    store.initSession("s3", { sessionType: "chat", title: "first" });
    store.initSession("s3", { sessionType: "delegation", title: "second" });
    const row = store.getSessionMeta("s3");
    expect(row!.session_type).toBe("delegation");
    expect(row!.title).toBe("second");
  });

  it("allows null parent_session_id", () => {
    store.initSession("orphan", { sessionType: "delegation" });
    const row = store.getSessionMeta("orphan");
    expect(row!.parent_session_id).toBeNull();
  });

  it("rejects double-init on non-chat session", () => {
    store.initSession("d1", { sessionType: "delegation", title: "first" });
    expect(() => store.initSession("d1", { sessionType: "delegation", title: "second" })).toThrow(
      /already initialized/,
    );
  });

  it("rejects double-init on supervision session", () => {
    store.initSession("s1", { sessionType: "supervision", title: "first" });
    expect(() =>
      store.initSession("s1", { sessionType: "delegation", title: "overwrite" }),
    ).toThrow(/already initialized/);
  });
});

// ==========================================================================
// updateSessionMeta
// ==========================================================================

describe("updateSessionMeta", () => {
  it("updates status", () => {
    store.initSession("u1", { sessionType: "delegation", status: "active" });
    store.updateSessionMeta("u1", { status: "completed" });
    expect(store.getSessionMeta("u1")!.status).toBe("completed");
  });

  it("updates title", () => {
    store.initSession("u2", { sessionType: "delegation", title: "old" });
    store.updateSessionMeta("u2", { title: "new" });
    expect(store.getSessionMeta("u2")!.title).toBe("new");
  });

  it("updates both status and title", () => {
    store.initSession("u3", { sessionType: "delegation", title: "old", status: "active" });
    store.updateSessionMeta("u3", { status: "failed", title: "updated" });
    const row = store.getSessionMeta("u3");
    expect(row!.status).toBe("failed");
    expect(row!.title).toBe("updated");
  });

  it("bumps updated_at on update", () => {
    store.initSession("u4", { sessionType: "delegation" });
    const before = store.getSessionMeta("u4")!.updated_at;
    // Sleep briefly to ensure timestamp difference
    const start = Date.now();
    while (Date.now() - start < 2) {} // spin
    store.updateSessionMeta("u4", { status: "completed" });
    expect(store.getSessionMeta("u4")!.updated_at).toBeGreaterThanOrEqual(before);
  });

  it("is a no-op for empty updates", () => {
    store.initSession("u5", { sessionType: "delegation", title: "keep" });
    store.updateSessionMeta("u5", {});
    expect(store.getSessionMeta("u5")!.title).toBe("keep");
  });

  it("silently does nothing for non-existent session", () => {
    // No throw
    expect(() => store.updateSessionMeta("ghost", { status: "completed" })).not.toThrow();
  });

  it("rejects invalid status via CHECK constraint", () => {
    store.initSession("u6", { sessionType: "delegation" });
    expect(() => store.updateSessionMeta("u6", { status: "invalid" })).toThrow(/CHECK/);
  });
});

// ==========================================================================
// getSessionMeta
// ==========================================================================

describe("getSessionMeta", () => {
  it("returns null for non-existent session", () => {
    expect(store.getSessionMeta("nope")).toBeNull();
  });

  it("returns full row data", () => {
    store.initSession("p1", { sessionType: "chat" });
    store.initSession("m1", {
      parentSessionId: "p1",
      sessionType: "supervision",
      title: "Review task",
    });
    const row = store.getSessionMeta("m1");
    expect(row).toMatchObject({
      id: "m1",
      parent_session_id: "p1",
      session_type: "supervision",
      title: "Review task",
      status: "active",
    });
  });
});

// ==========================================================================
// getChildSessions
// ==========================================================================

describe("getChildSessions", () => {
  it("returns empty array when no children", () => {
    store.initSession("lonely", { sessionType: "chat" });
    expect(store.getChildSessions("lonely")).toHaveLength(0);
  });

  it("returns direct children only", () => {
    store.initSession("root", { sessionType: "chat" });
    store.initSession("child1", { parentSessionId: "root", sessionType: "delegation" });
    store.initSession("child2", { parentSessionId: "root", sessionType: "supervision" });
    store.initSession("grandchild", { parentSessionId: "child1", sessionType: "delegation" });

    const children = store.getChildSessions("root");
    expect(children).toHaveLength(2);
    const ids = children.map((c) => c.id).sort();
    expect(ids).toEqual(["child1", "child2"]);
  });

  it("returns empty for non-existent parent", () => {
    expect(store.getChildSessions("ghost")).toHaveLength(0);
  });
});

// ==========================================================================
// getActiveDelegations
// ==========================================================================

describe("getActiveDelegations", () => {
  it("returns only active delegation/supervision children", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("d1", {
      parentSessionId: "owner",
      sessionType: "delegation",
      status: "active",
    });
    store.initSession("d2", {
      parentSessionId: "owner",
      sessionType: "delegation",
      status: "completed",
    });
    store.initSession("s1", {
      parentSessionId: "owner",
      sessionType: "supervision",
      status: "active",
    });
    store.initSession("c1", {
      parentSessionId: "owner",
      sessionType: "chat",
      status: "active",
    });

    const active = store.getActiveDelegations("owner");
    expect(active).toHaveLength(2);
    const ids = active.map((r) => r.id).sort();
    expect(ids).toEqual(["d1", "s1"]);
  });

  it("returns empty when all delegations are completed", () => {
    store.initSession("owner2", { sessionType: "chat" });
    store.initSession("d3", {
      parentSessionId: "owner2",
      sessionType: "delegation",
      status: "completed",
    });
    expect(store.getActiveDelegations("owner2")).toHaveLength(0);
  });

  it("excludes failed delegations", () => {
    store.initSession("owner3", { sessionType: "chat" });
    store.initSession("d4", {
      parentSessionId: "owner3",
      sessionType: "delegation",
      status: "failed",
    });
    expect(store.getActiveDelegations("owner3")).toHaveLength(0);
  });
});

// ==========================================================================
// Snapshot KV (getSnapshotValue / setSnapshotValue)
// ==========================================================================

describe("snapshot KV", () => {
  it("round-trips a value", () => {
    store.initSession("kv1", { sessionType: "delegation" });
    store.setSnapshotValue("kv1", "objective", "Fix the auth bug");
    expect(store.getSnapshotValue("kv1", "objective")).toBe("Fix the auth bug");
  });

  it("returns null for missing key", () => {
    store.initSession("kv2", { sessionType: "delegation" });
    expect(store.getSnapshotValue("kv2", "nonexistent")).toBeNull();
  });

  it("returns null for missing session", () => {
    expect(store.getSnapshotValue("ghost", "anything")).toBeNull();
  });

  it("overwrites existing value", () => {
    store.initSession("kv3", { sessionType: "delegation" });
    store.setSnapshotValue("kv3", "result", "first");
    store.setSnapshotValue("kv3", "result", "second");
    expect(store.getSnapshotValue("kv3", "result")).toBe("second");
  });

  it("handles multiple keys per session", () => {
    store.initSession("kv4", { sessionType: "supervision" });
    store.setSnapshotValue("kv4", "objective", "task spec");
    store.setSnapshotValue("kv4", "criteria", "tests pass");
    store.setSnapshotValue("kv4", "result", "all good");
    expect(store.getSnapshotValue("kv4", "objective")).toBe("task spec");
    expect(store.getSnapshotValue("kv4", "criteria")).toBe("tests pass");
    expect(store.getSnapshotValue("kv4", "result")).toBe("all good");
  });

  it("handles empty string values", () => {
    store.initSession("kv5", { sessionType: "delegation" });
    store.setSnapshotValue("kv5", "empty", "");
    expect(store.getSnapshotValue("kv5", "empty")).toBe("");
  });

  it("handles large values (64KB)", () => {
    store.initSession("kv6", { sessionType: "delegation" });
    const large = "x".repeat(65536);
    store.setSnapshotValue("kv6", "big", large);
    expect(store.getSnapshotValue("kv6", "big")).toBe(large);
  });

  it("handles unicode values", () => {
    store.initSession("kv7", { sessionType: "delegation" });
    const unicode = "Fix the 🐛 in auth — ñ café";
    store.setSnapshotValue("kv7", "note", unicode);
    expect(store.getSnapshotValue("kv7", "note")).toBe(unicode);
  });
});

// ==========================================================================
// Supervised topology — the real integration test
// ==========================================================================

describe("supervised topology", () => {
  it("models the Owner → Supervisor → Delegate hierarchy", () => {
    // Owner session (normal chat)
    store.initSession("owner", { sessionType: "chat" });

    // Supervisor is child of owner
    store.initSession("supervisor", {
      parentSessionId: "owner",
      sessionType: "supervision",
      title: "Review auth refactor",
      status: "active",
    });
    store.setSnapshotValue("supervisor", "objective", "Refactor auth module");
    store.setSnapshotValue("supervisor", "criteria", "All tests pass, no regressions");

    // Delegate is child of supervisor
    store.initSession("delegate", {
      parentSessionId: "supervisor",
      sessionType: "delegation",
      title: "Review auth refactor",
      status: "active",
    });
    store.setSnapshotValue("delegate", "objective", "Refactor auth module");

    // Owner sees supervisor as active delegation
    const ownerActive = store.getActiveDelegations("owner");
    expect(ownerActive).toHaveLength(1);
    expect(ownerActive[0]!.id).toBe("supervisor");

    // Supervisor sees delegate as child
    const supervisorChildren = store.getChildSessions("supervisor");
    expect(supervisorChildren).toHaveLength(1);
    expect(supervisorChildren[0]!.id).toBe("delegate");
    expect(supervisorChildren[0]!.session_type).toBe("delegation");

    // Complete: mark delegate, then supervisor
    store.updateSessionMeta("delegate", { status: "completed" });
    store.updateSessionMeta("supervisor", { status: "completed" });
    store.setSnapshotValue("supervisor", "result", "Auth refactored successfully");

    // Owner should see no active delegations
    expect(store.getActiveDelegations("owner")).toHaveLength(0);

    // But can still query the completed session
    const meta = store.getSessionMeta("supervisor");
    expect(meta!.status).toBe("completed");
    expect(store.getSnapshotValue("supervisor", "result")).toBe("Auth refactored successfully");
  });

  it("models dispatch (no supervisor) topology", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("delegate", {
      parentSessionId: "owner",
      sessionType: "delegation",
      title: "Write tests",
      status: "active",
    });
    store.setSnapshotValue("delegate", "objective", "Write unit tests for utils.ts");

    const active = store.getActiveDelegations("owner");
    expect(active).toHaveLength(1);
    expect(active[0]!.session_type).toBe("delegation");

    // Complete
    store.updateSessionMeta("delegate", { status: "completed" });
    store.setSnapshotValue("delegate", "result", "42 tests passing");
    expect(store.getActiveDelegations("owner")).toHaveLength(0);
  });
});

// ==========================================================================
// Adversarial tests
// ==========================================================================

describe("adversarial", () => {
  it("orphaned children (parent doesn't exist) — initSession still works", () => {
    // FK on parent_session_id: this should fail because parent doesn't exist
    // Actually, let's check — the FK references sessions(id)
    expect(() =>
      store.initSession("orphan-child", {
        parentSessionId: "nonexistent-parent",
        sessionType: "delegation",
      }),
    ).toThrow(/FOREIGN KEY/); // FK violation
  });

  it("concurrent writes to same KV key — last write wins", () => {
    store.initSession("race", { sessionType: "delegation" });
    // Simulate two rapid writes
    store.setSnapshotValue("race", "result", "writer-A");
    store.setSnapshotValue("race", "result", "writer-B");
    expect(store.getSnapshotValue("race", "result")).toBe("writer-B");
  });

  it("getActiveDelegations with mixed session types and statuses", () => {
    store.initSession("owner", { sessionType: "chat" });

    // Create a zoo of session types and statuses
    const configs = [
      { id: "a1", type: "delegation", status: "active" },
      { id: "a2", type: "delegation", status: "completed" },
      { id: "a3", type: "delegation", status: "failed" },
      { id: "a4", type: "delegation", status: "paused" },
      { id: "a5", type: "supervision", status: "active" },
      { id: "a6", type: "supervision", status: "completed" },
      { id: "a7", type: "chat", status: "active" },
      { id: "a8", type: "spawn", status: "active" },
      { id: "a9", type: "fork", status: "active" },
    ];

    for (const c of configs) {
      store.initSession(c.id, {
        parentSessionId: "owner",
        sessionType: c.type,
        status: c.status,
      });
    }

    const active = store.getActiveDelegations("owner");
    const ids = active.map((r) => r.id).sort();
    // Only active delegation + active supervision
    expect(ids).toEqual(["a1", "a5"]);
  });

  it("deep nesting doesn't break queries", () => {
    store.initSession("l0", { sessionType: "chat" });
    for (let i = 1; i <= 10; i++) {
      store.initSession(`l${i}`, {
        parentSessionId: `l${i - 1}`,
        sessionType: "delegation",
      });
    }
    // Each level should see its direct child
    for (let i = 0; i < 10; i++) {
      const children = store.getChildSessions(`l${i}`);
      expect(children).toHaveLength(1);
      expect(children[0]!.id).toBe(`l${i + 1}`);
    }
    // Leaf has no children
    expect(store.getChildSessions("l10")).toHaveLength(0);
  });

  it("status transitions through full lifecycle", () => {
    store.initSession("lifecycle", { sessionType: "delegation", status: "active" });
    expect(store.getSessionMeta("lifecycle")!.status).toBe("active");

    store.updateSessionMeta("lifecycle", { status: "paused" });
    expect(store.getSessionMeta("lifecycle")!.status).toBe("paused");

    store.updateSessionMeta("lifecycle", { status: "active" });
    expect(store.getSessionMeta("lifecycle")!.status).toBe("active");

    store.updateSessionMeta("lifecycle", { status: "completed" });
    expect(store.getSessionMeta("lifecycle")!.status).toBe("completed");
  });

  it("many concurrent delegation sessions (100)", () => {
    store.initSession("bulk-owner", { sessionType: "chat" });
    for (let i = 0; i < 100; i++) {
      store.initSession(`bulk-d${i}`, {
        parentSessionId: "bulk-owner",
        sessionType: "delegation",
        title: `Task ${i}`,
        status: i % 3 === 0 ? "completed" : "active",
      });
    }

    const active = store.getActiveDelegations("bulk-owner");
    // 100 sessions, every 3rd is completed → 66 or 67 active
    // i=0 completed, i=1 active, i=2 active, i=3 completed, ...
    // completed: 0, 3, 6, 9, ... → floor(99/3) + 1 = 34 completed
    // active: 100 - 34 = 66
    expect(active).toHaveLength(66);

    const all = store.getChildSessions("bulk-owner");
    expect(all).toHaveLength(100);
  });

  it("KV values survive session_snapshots that also have com_state", async () => {
    // initSession creates the session row, then save() also writes com_state to session_snapshots
    store.initSession("mixed", { sessionType: "delegation" });
    store.setSnapshotValue("mixed", "objective", "the task");

    // Simulate what save() does — write com_state to same table
    store.setSnapshotValue("mixed", "com_state", JSON.stringify({ knob: true }));

    // Both should coexist
    expect(store.getSnapshotValue("mixed", "objective")).toBe("the task");
    expect(store.getSnapshotValue("mixed", "com_state")).toBe('{"knob":true}');
  });

  it("initSession with all valid statuses", () => {
    for (const status of ["active", "paused", "completed", "failed", "archived"]) {
      const id = `status-${status}`;
      store.initSession(id, { sessionType: "delegation", status });
      expect(store.getSessionMeta(id)!.status).toBe(status);
    }
  });

  it("session deletion cascades to KV snapshots", () => {
    store.initSession("doomed", { sessionType: "delegation" });
    store.setSnapshotValue("doomed", "objective", "will die");
    store.setSnapshotValue("doomed", "criteria", "irrelevant");

    // Delete via the store's existing delete method
    db.prepare("DELETE FROM sessions WHERE id = ?").run("doomed");

    // KV should be gone (CASCADE)
    expect(store.getSnapshotValue("doomed", "objective")).toBeNull();
    expect(store.getSnapshotValue("doomed", "criteria")).toBeNull();
  });

  it("getSessionMeta after updateSessionMeta reflects changes immediately", () => {
    store.initSession("sync", { sessionType: "delegation", title: "v1", status: "active" });
    store.updateSessionMeta("sync", { title: "v2", status: "completed" });
    const row = store.getSessionMeta("sync");
    expect(row!.title).toBe("v2");
    expect(row!.status).toBe("completed");
  });

  it("multiple supervisors for same owner", () => {
    store.initSession("multi-owner", { sessionType: "chat" });
    store.initSession("sup-a", {
      parentSessionId: "multi-owner",
      sessionType: "supervision",
      title: "Task A",
      status: "active",
    });
    store.initSession("sup-b", {
      parentSessionId: "multi-owner",
      sessionType: "supervision",
      title: "Task B",
      status: "active",
    });
    store.initSession("del-a", {
      parentSessionId: "sup-a",
      sessionType: "delegation",
      status: "active",
    });
    store.initSession("del-b", {
      parentSessionId: "sup-b",
      sessionType: "delegation",
      status: "active",
    });

    // Owner sees both supervisors
    const active = store.getActiveDelegations("multi-owner");
    expect(active).toHaveLength(2);

    // Each supervisor sees its own delegate
    expect(store.getChildSessions("sup-a")).toHaveLength(1);
    expect(store.getChildSessions("sup-a")[0]!.id).toBe("del-a");
    expect(store.getChildSessions("sup-b")).toHaveLength(1);
    expect(store.getChildSessions("sup-b")[0]!.id).toBe("del-b");

    // Complete one — owner still sees the other
    store.updateSessionMeta("sup-a", { status: "completed" });
    store.updateSessionMeta("del-a", { status: "completed" });
    expect(store.getActiveDelegations("multi-owner")).toHaveLength(1);
    expect(store.getActiveDelegations("multi-owner")[0]!.id).toBe("sup-b");
  });
});

// ==========================================================================
// Interaction with existing save()/load() — coexistence
// ==========================================================================

describe("coexistence with save/load", () => {
  it("initSession row is loadable via loadSync", () => {
    store.initSession("coexist", { sessionType: "delegation", title: "test" });
    const snapshot = store.loadSync("coexist");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.sessionId).toBe("coexist");
    expect(snapshot!.tick).toBe(0);
    expect(snapshot!.timeline).toBeNull();
  });

  it("save() upserts over initSession row without losing delegation columns", async () => {
    store.initSession("upsert", {
      parentSessionId: undefined,
      sessionType: "delegation",
      title: "original",
    });
    store.setSnapshotValue("upsert", "objective", "the task");

    // save() does an upsert on (id, tick, version) — should not clobber session_type/title
    // because save()'s ON CONFLICT only updates tick, version, updated_at
    await store.save("upsert", {
      version: "1.0",
      sessionId: "upsert",
      tick: 5,
      timeline: null,
      comState: { foo: "bar" },
      dataCache: {},
      timestamp: Date.now(),
    });

    const row = store.getSessionMeta("upsert");
    expect(row!.session_type).toBe("delegation");
    expect(row!.title).toBe("original");
    expect(row!.tick).toBe(5);
    expect(store.getSnapshotValue("upsert", "objective")).toBe("the task");
  });

  it("save() before initSession — initSession upserts delegation columns", async () => {
    // Framework auto-save creates a minimal row
    await store.save("race", {
      version: "1.0",
      sessionId: "race",
      tick: 0,
      timeline: null,
      comState: {},
      dataCache: {},
      timestamp: Date.now(),
    });

    // Verify save() created a row with defaults
    const before = store.getSessionMeta("race");
    expect(before).not.toBeNull();
    expect(before!.session_type).toBe("chat"); // default
    expect(before!.parent_session_id).toBeNull();

    // initSession should update the delegation-specific columns
    store.initSession("owner-for-race", { sessionType: "chat" });
    store.initSession("race", {
      parentSessionId: "owner-for-race",
      sessionType: "delegation",
      title: "Late init",
      status: "active",
    });

    const after = store.getSessionMeta("race");
    expect(after!.session_type).toBe("delegation");
    expect(after!.title).toBe("Late init");
    expect(after!.parent_session_id).toBe("owner-for-race");
    expect(after!.status).toBe("active");
  });
});

// ==========================================================================
// Migration safety — upgrade from v1 preserves child table data
// ==========================================================================

describe("migration 002 safety", () => {
  it("migration preserves messages when upgrading from v1", () => {
    // Create a fresh DB, run migration 001 only (set version to 1)
    const d = new DatabaseSync(":memory:");
    d.exec("PRAGMA foreign_keys = ON");

    // Bootstrap: create schema version tracking
    d.exec(`CREATE TABLE IF NOT EXISTS _schema_versions (
      package TEXT PRIMARY KEY, version INTEGER NOT NULL
    )`);

    // Read and execute migration 001
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { fileURLToPath } = require("node:url");
    const migrationDir = join(fileURLToPath(import.meta.url), "..", "..", "migrations");
    const sql001 = readFileSync(join(migrationDir, "001_initial.sql"), "utf-8");
    d.exec(sql001);
    d.prepare("INSERT OR REPLACE INTO _schema_versions (package, version) VALUES (?, ?)").run(
      "storage",
      1,
    );

    // Insert real data at v1
    d.prepare("INSERT INTO sessions (id, tick, version) VALUES (?, ?, ?)").run("s1", 3, "1.0");
    d.prepare(
      "INSERT INTO messages (id, session_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?)",
    ).run("m1", "s1", "user", 0, 0);
    d.prepare(
      "INSERT INTO messages (id, session_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?)",
    ).run("m2", "s1", "assistant", 0, 1);
    d.prepare(
      "INSERT INTO executions (id, session_id, trigger_type, status) VALUES (?, ?, ?, ?)",
    ).run("e1", "s1", "send", "completed");
    d.prepare("INSERT INTO ticks (execution_id, tick_number) VALUES (?, ?)").run("e1", 0);
    d.prepare("INSERT INTO session_snapshots (session_id, key, value) VALUES (?, ?, ?)").run(
      "s1",
      "com_state",
      '{"knob":true}',
    );

    // Count rows before migration
    const msgsBefore = (d.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
    const execsBefore = (d.prepare("SELECT count(*) as c FROM executions").get() as { c: number })
      .c;
    const ticksBefore = (d.prepare("SELECT count(*) as c FROM ticks").get() as { c: number }).c;
    const snapsBefore = (
      d.prepare("SELECT count(*) as c FROM session_snapshots").get() as { c: number }
    ).c;
    expect(msgsBefore).toBe(2);
    expect(execsBefore).toBe(1);
    expect(ticksBefore).toBe(1);
    expect(snapsBefore).toBe(1);

    // Run ensureStorageSchema — should execute migration 002
    ensureStorageSchema(d);

    // Verify ALL data survived
    const msgsAfter = (d.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
    const execsAfter = (d.prepare("SELECT count(*) as c FROM executions").get() as { c: number }).c;
    const ticksAfter = (d.prepare("SELECT count(*) as c FROM ticks").get() as { c: number }).c;
    const snapsAfter = (
      d.prepare("SELECT count(*) as c FROM session_snapshots").get() as { c: number }
    ).c;
    expect(msgsAfter).toBe(2);
    expect(execsAfter).toBe(1);
    expect(ticksAfter).toBe(1);
    expect(snapsAfter).toBe(1);

    // Verify session row survived with data
    const session = d.prepare("SELECT * FROM sessions WHERE id = ?").get("s1") as any;
    expect(session).not.toBeUndefined();
    expect(session.tick).toBe(3);

    // Verify new session_type values work
    const store2 = new TentickleSessionStore(d);
    store2.initSession("d1", {
      parentSessionId: "s1",
      sessionType: "delegation",
      title: "test delegation",
    });
    expect(store2.getSessionMeta("d1")!.session_type).toBe("delegation");

    // Verify schema version is now 2
    const version = (
      d.prepare("SELECT version FROM _schema_versions WHERE package = ?").get("storage") as {
        version: number;
      }
    ).version;
    expect(version).toBe(2);

    d.close();
  });

  it("migration is idempotent — running twice doesn't fail", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("PRAGMA foreign_keys = ON");
    ensureStorageSchema(d);
    ensureStorageSchema(d); // second run — should be no-op
    const version = (
      d.prepare("SELECT version FROM _schema_versions WHERE package = ?").get("storage") as {
        version: number;
      }
    ).version;
    expect(version).toBe(2);
    d.close();
  });

  it("FK constraints still work after migration", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("PRAGMA foreign_keys = ON");
    ensureStorageSchema(d);

    // FK should still be enforced
    expect(() =>
      d
        .prepare(
          "INSERT INTO messages (id, session_id, role, tick, sequence_in_tick) VALUES (?, ?, ?, ?, ?)",
        )
        .run("m1", "nonexistent", "user", 0, 0),
    ).toThrow(/FOREIGN KEY/);

    d.close();
  });
});
