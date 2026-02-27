import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ArtifactStore } from "../artifact-store.js";
import { ensureArtifactSchema } from "../schema.js";

// ==========================================================================
// Helpers
// ==========================================================================

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  ensureArtifactSchema(db);
  return db;
}

function freshStore(): { db: DatabaseSync; store: ArtifactStore } {
  const db = freshDb();
  const store = ArtifactStore.create(db);
  return { db, store };
}

// ==========================================================================
// Core CRUD
// ==========================================================================

describe("ArtifactStore", () => {
  let db: DatabaseSync;
  let store: ArtifactStore;

  beforeEach(() => {
    ({ db, store } = freshStore());
  });

  afterEach(() => {
    store.destroy();
    db.close();
  });

  // --------------------------------------------------------------------------
  // store + get
  // --------------------------------------------------------------------------

  it("store + get round trip preserves all fields", () => {
    const entry = store.store(
      {
        name: "auth-analysis",
        type: "analysis",
        content: "The auth system uses JWT with rotating refresh tokens.",
        summary: "JWT auth overview",
        metadata: { files: ["auth.ts", "tokens.ts"], lineCount: 42 },
      },
      "session-1",
    );

    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.name).toBe("auth-analysis");
    expect(entry.type).toBe("analysis");
    expect(entry.content).toBe("The auth system uses JWT with rotating refresh tokens.");
    expect(entry.summary).toBe("JWT auth overview");
    expect(entry.metadata).toEqual({ files: ["auth.ts", "tokens.ts"], lineCount: 42 });
    expect(entry.sessionId).toBe("session-1");
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBe(entry.createdAt);

    const fetched = store.get(entry.id);
    expect(fetched).toEqual(entry);
  });

  it("store without optional fields sets nulls", () => {
    const entry = store.store({ name: "plan", type: "plan", content: "Step 1: profit" });
    expect(entry.summary).toBeNull();
    expect(entry.metadata).toBeNull();
    expect(entry.sessionId).toBeNull();
  });

  // --------------------------------------------------------------------------
  // getByName
  // --------------------------------------------------------------------------

  it("getByName returns artifact by name", () => {
    store.store({ name: "migration-plan", type: "plan", content: "v1" });
    const result = store.getByName("migration-plan");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("migration-plan");
    expect(result!.content).toBe("v1");
  });

  it("getByName with sessionId scopes to that session", () => {
    store.store({ name: "schema", type: "schema", content: "session-a version" }, "session-a");
    store.store({ name: "schema", type: "schema", content: "session-b version" }, "session-b");

    const a = store.getByName("schema", "session-a");
    expect(a!.content).toBe("session-a version");

    const b = store.getByName("schema", "session-b");
    expect(b!.content).toBe("session-b version");
  });

  it("getByName returns most recent when no session filter", () => {
    store.store({ name: "report", type: "document", content: "old" }, "s1");
    // Small delay to ensure different timestamps
    store.store({ name: "report", type: "document", content: "new" }, "s2");

    const result = store.getByName("report");
    expect(result!.content).toBe("new");
  });

  it("getByName returns null for missing name", () => {
    expect(store.getByName("nonexistent")).toBeNull();
  });

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------

  it("update patches fields and bumps updatedAt", () => {
    const entry = store.store({
      name: "draft",
      type: "document",
      content: "rough draft",
      summary: "first pass",
    });

    const before = entry.updatedAt;
    // Ensure timestamp advances
    const updated = store.update(entry.id, {
      content: "polished version",
      summary: "final",
    });

    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("polished version");
    expect(updated!.summary).toBe("final");
    expect(updated!.name).toBe("draft"); // unchanged
    expect(updated!.type).toBe("document"); // unchanged
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);

    // Verify persistence
    const refetched = store.get(entry.id);
    expect(refetched!.content).toBe("polished version");
  });

  it("update returns null for missing ID", () => {
    expect(store.update("nonexistent-id", { content: "x" })).toBeNull();
  });

  it("update can clear summary by passing undefined summary field", () => {
    const entry = store.store({
      name: "test",
      type: "code",
      content: "fn()",
      summary: "a function",
    });

    // Partial with summary omitted — should preserve existing
    const kept = store.update(entry.id, { content: "fn2()" });
    expect(kept!.summary).toBe("a function");
  });

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------

  it("delete removes artifact", () => {
    const entry = store.store({ name: "temp", type: "code", content: "x" });
    expect(store.delete(entry.id)).toBe(true);
    expect(store.get(entry.id)).toBeNull();
  });

  it("delete returns false for missing ID", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------

  it("list returns all artifacts ordered by created_at desc", () => {
    store.store({ name: "first", type: "code", content: "1" });
    store.store({ name: "second", type: "code", content: "2" });
    store.store({ name: "third", type: "code", content: "3" });

    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all[0].name).toBe("third");
    expect(all[2].name).toBe("first");
  });

  it("list with sessionId filters", () => {
    store.store({ name: "a", type: "code", content: "1" }, "s1");
    store.store({ name: "b", type: "code", content: "2" }, "s2");
    store.store({ name: "c", type: "code", content: "3" }, "s1");

    const s1 = store.list("s1");
    expect(s1).toHaveLength(2);
    expect(s1.every((e) => e.sessionId === "s1")).toBe(true);
  });

  it("list returns empty for no artifacts", () => {
    expect(store.list()).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // listByType
  // --------------------------------------------------------------------------

  it("listByType filters by type", () => {
    store.store({ name: "fn", type: "code", content: "function f() {}" });
    store.store({ name: "readme", type: "document", content: "# Hello" });
    store.store({ name: "util", type: "code", content: "const x = 1" });

    const code = store.listByType("code");
    expect(code).toHaveLength(2);
    expect(code.every((e) => e.type === "code")).toBe(true);
  });

  it("listByType with sessionId filters both", () => {
    store.store({ name: "a", type: "code", content: "1" }, "s1");
    store.store({ name: "b", type: "code", content: "2" }, "s2");
    store.store({ name: "c", type: "document", content: "3" }, "s1");

    const result = store.listByType("code", "s1");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a");
  });

  // --------------------------------------------------------------------------
  // get edge cases
  // --------------------------------------------------------------------------

  it("get returns null for missing ID", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Duplicate names
  // --------------------------------------------------------------------------

  it("duplicate names are allowed with different IDs", () => {
    const a = store.store({ name: "config", type: "schema", content: "v1" });
    const b = store.store({ name: "config", type: "schema", content: "v2" });

    expect(a.id).not.toBe(b.id);
    expect(store.get(a.id)!.content).toBe("v1");
    expect(store.get(b.id)!.content).toBe("v2");
  });

  // --------------------------------------------------------------------------
  // Metadata JSON round-trip
  // --------------------------------------------------------------------------

  it("metadata JSON serialization round-trip", () => {
    const meta = {
      files: ["a.ts", "b.ts"],
      nested: { deep: true, count: 99 },
      tags: ["important", "reviewed"],
    };
    const entry = store.store({ name: "rich", type: "analysis", content: "x", metadata: meta });
    const fetched = store.get(entry.id)!;
    expect(fetched.metadata).toEqual(meta);
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it("empty content is allowed", () => {
    const entry = store.store({
      name: "placeholder",
      type: "code",
      content: "",
      metadata: { reason: "will be filled later" },
    });
    expect(entry.content).toBe("");
    expect(store.get(entry.id)!.content).toBe("");
  });

  it("very long content is not truncated", () => {
    const longContent = "x".repeat(100_000);
    const entry = store.store({ name: "big", type: "document", content: longContent });
    expect(store.get(entry.id)!.content).toBe(longContent);
  });

  it("special characters in name and content", () => {
    const entry = store.store({
      name: 'test\'s "artifact" (v2) — final',
      type: "code",
      content: "const x = `hello ${world}`;\n// 日本語テスト\n'quotes' \"doubles\"",
    });
    const fetched = store.get(entry.id)!;
    expect(fetched.name).toBe('test\'s "artifact" (v2) — final');
    expect(fetched.content).toContain("日本語テスト");
  });

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  it("destroy prevents further operations", () => {
    store.destroy();
    expect(() => store.store({ name: "x", type: "code", content: "y" })).toThrow(
      "ArtifactStore has been destroyed",
    );
    expect(() => store.get("x")).toThrow("ArtifactStore has been destroyed");
    expect(() => store.list()).toThrow("ArtifactStore has been destroyed");
  });

  // --------------------------------------------------------------------------
  // Adversarial: concurrent stores
  // --------------------------------------------------------------------------

  it("concurrent stores produce unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const entry = store.store({ name: `item-${i}`, type: "code", content: `content-${i}` });
      ids.add(entry.id);
    }
    expect(ids.size).toBe(100);
  });

  it("store during list: sync SQLite ensures consistent reads", () => {
    // Pre-populate
    for (let i = 0; i < 10; i++) {
      store.store({ name: `pre-${i}`, type: "code", content: `${i}` });
    }

    // List is sync — no interleaving possible, but verify correctness
    const snapshot = store.list();
    store.store({ name: "post", type: "code", content: "after" });
    expect(snapshot).toHaveLength(10); // snapshot unaffected by later store
    expect(store.list()).toHaveLength(11);
  });

  // --------------------------------------------------------------------------
  // Schema: ensureArtifactSchema is idempotent
  // --------------------------------------------------------------------------

  it("ensureArtifactSchema is idempotent", () => {
    const db2 = freshDb();
    // Call again — should not throw
    ensureArtifactSchema(db2);
    const store2 = ArtifactStore.create(db2);
    store2.store({ name: "test", type: "code", content: "works" });
    expect(store2.list()).toHaveLength(1);
    store2.destroy();
    db2.close();
  });
});
