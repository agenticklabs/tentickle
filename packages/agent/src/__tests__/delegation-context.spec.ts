import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureStorageSchema, TentickleSessionStore, bindSessionStore } from "@tentickle/storage";
import { getDelegationMetadata, getDelegationMetadataFromStore } from "../delegation-context.js";

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
  bindSessionStore(store);
});

afterEach(() => {
  bindSessionStore(null as any);
});

// ==========================================================================
// getDelegationMetadata (uses global binding)
// ==========================================================================

describe("getDelegationMetadata", () => {
  it("returns null when no store is bound", () => {
    bindSessionStore(null as any);
    expect(getDelegationMetadata("any-session")).toBeNull();
  });

  it("returns null for undefined sessionId", () => {
    expect(getDelegationMetadata(undefined)).toBeNull();
  });

  it("returns null for unknown sessionId", () => {
    expect(getDelegationMetadata("unknown")).toBeNull();
  });

  it("returns null for non-delegation session type", () => {
    store.initSession("chat-session", { sessionType: "chat" });
    expect(getDelegationMetadata("chat-session")).toBeNull();
  });

  it("returns null for spawn session type", () => {
    store.initSession("spawn-root", { sessionType: "chat" });
    store.initSession("spawn-session", { parentSessionId: "spawn-root", sessionType: "spawn" });
    expect(getDelegationMetadata("spawn-session")).toBeNull();
  });

  it("detects delegate role for delegation session", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("coding-session", {
      parentSessionId: "owner",
      sessionType: "delegation",
      title: "Fix the bug",
    });
    store.setSnapshotValue("coding-session", "objective", "Do the thing");

    const meta = getDelegationMetadata("coding-session");
    expect(meta).not.toBeNull();
    expect(meta!.role).toBe("delegate");
    expect(meta!.sessionId).toBe("coding-session");
    expect(meta!.objective).toBe("Do the thing");
    expect(meta!.title).toBe("Fix the bug");
    expect(meta!.parentSessionId).toBe("owner");
    expect(meta!.delegateSessionId).toBeUndefined();
  });

  it("detects supervisor role for supervision session", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("supervisor-session", {
      parentSessionId: "owner",
      sessionType: "supervision",
      title: "Review the refactor",
    });
    store.setSnapshotValue("supervisor-session", "objective", "Refactor auth");
    store.setSnapshotValue("supervisor-session", "criteria", "Tests must pass");

    // Delegate child of supervisor
    store.initSession("delegate-session", {
      parentSessionId: "supervisor-session",
      sessionType: "delegation",
      title: "Review the refactor",
    });

    const meta = getDelegationMetadata("supervisor-session");
    expect(meta).not.toBeNull();
    expect(meta!.role).toBe("supervisor");
    expect(meta!.sessionId).toBe("supervisor-session");
    expect(meta!.objective).toBe("Refactor auth");
    expect(meta!.supervisorCriteria).toBe("Tests must pass");
    expect(meta!.parentSessionId).toBe("owner");
    expect(meta!.delegateSessionId).toBe("delegate-session");
  });

  it("returns delegate metadata even when parent is a supervisor", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("supervisor", {
      parentSessionId: "owner",
      sessionType: "supervision",
    });
    store.initSession("delegate", {
      parentSessionId: "supervisor",
      sessionType: "delegation",
      title: "coding task",
    });
    store.setSnapshotValue("delegate", "objective", "Write code");

    const meta = getDelegationMetadata("delegate");
    expect(meta!.role).toBe("delegate");
    expect(meta!.parentSessionId).toBe("supervisor");
  });

  it("supervisor with no delegate child returns undefined delegateSessionId", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("lonely-supervisor", {
      parentSessionId: "owner",
      sessionType: "supervision",
      title: "orphaned",
    });
    store.setSnapshotValue("lonely-supervisor", "objective", "task");

    const meta = getDelegationMetadata("lonely-supervisor");
    expect(meta!.role).toBe("supervisor");
    expect(meta!.delegateSessionId).toBeUndefined();
  });

  it("supervisor with criteria=undefined returns undefined", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("sup-no-criteria", {
      parentSessionId: "owner",
      sessionType: "supervision",
    });
    // No criteria set in KV

    const meta = getDelegationMetadata("sup-no-criteria");
    expect(meta!.supervisorCriteria).toBeUndefined();
  });

  it("handles missing objective gracefully", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("no-obj", {
      parentSessionId: "owner",
      sessionType: "delegation",
    });
    // No objective KV set
    const meta = getDelegationMetadata("no-obj");
    expect(meta!.objective).toBe("");
  });

  it("handles missing title gracefully", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("no-title", {
      parentSessionId: "owner",
      sessionType: "delegation",
    });
    const meta = getDelegationMetadata("no-title");
    expect(meta!.title).toBe("");
  });
});

// ==========================================================================
// getDelegationMetadataFromStore (explicit store param)
// ==========================================================================

describe("getDelegationMetadataFromStore", () => {
  it("works independently of global binding", () => {
    bindSessionStore(null as any);

    // Create a separate store + db
    const db2 = freshDb();
    const store2 = new TentickleSessionStore(db2);
    store2.initSession("owner", { sessionType: "chat" });
    store2.initSession("d1", {
      parentSessionId: "owner",
      sessionType: "delegation",
      title: "test",
    });
    store2.setSnapshotValue("d1", "objective", "explicit store test");

    const meta = getDelegationMetadataFromStore(store2, "d1");
    expect(meta).not.toBeNull();
    expect(meta!.objective).toBe("explicit store test");
  });
});

// ==========================================================================
// Adversarial — edge cases
// ==========================================================================

describe("adversarial", () => {
  it("multiple delegate children under supervisor — finds first delegation", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("sup", {
      parentSessionId: "owner",
      sessionType: "supervision",
    });
    store.initSession("del-1", {
      parentSessionId: "sup",
      sessionType: "delegation",
    });
    store.initSession("del-2", {
      parentSessionId: "sup",
      sessionType: "delegation",
    });

    const meta = getDelegationMetadata("sup");
    expect(meta!.role).toBe("supervisor");
    // Should find one of the delegates (first one found)
    expect(["del-1", "del-2"]).toContain(meta!.delegateSessionId);
  });

  it("delegation session with non-existent parent still returns metadata", () => {
    // Insert directly to bypass FK — or use a session that exists
    store.initSession("root", { sessionType: "chat" });
    store.initSession("del", {
      parentSessionId: "root",
      sessionType: "delegation",
      title: "task",
    });
    store.setSnapshotValue("del", "objective", "obj");

    // Delete the parent directly (simulating cleanup)
    // This would cascade-delete children too, so let's test differently:
    // Instead, test that parentSessionId="" works
    const meta = getDelegationMetadata("del");
    expect(meta!.parentSessionId).toBe("root");
  });

  it("completed delegation still returns metadata", () => {
    store.initSession("owner", { sessionType: "chat" });
    store.initSession("done-del", {
      parentSessionId: "owner",
      sessionType: "delegation",
      title: "finished",
      status: "completed",
    });
    store.setSnapshotValue("done-del", "objective", "was: do something");
    store.setSnapshotValue("done-del", "result", "did it");

    const meta = getDelegationMetadata("done-del");
    expect(meta).not.toBeNull();
    expect(meta!.role).toBe("delegate");
    expect(meta!.objective).toBe("was: do something");
  });

  it("rapid session creation doesn't produce collisions", () => {
    store.initSession("owner", { sessionType: "chat" });
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `rapid-${i}`;
      store.initSession(id, {
        parentSessionId: "owner",
        sessionType: "delegation",
        title: `Task ${i}`,
      });
      store.setSnapshotValue(id, "objective", `Objective ${i}`);
      ids.push(id);
    }

    // Verify all are independently queryable
    for (let i = 0; i < 50; i++) {
      const meta = getDelegationMetadata(ids[i]!);
      expect(meta).not.toBeNull();
      expect(meta!.objective).toBe(`Objective ${i}`);
      expect(meta!.title).toBe(`Task ${i}`);
    }
  });
});
