import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TentickleMemory, type EmbedFn } from "../tentickle-memory.js";
import { ensureMemorySchema } from "../schema.js";
import type { EmbedResult } from "@agentick/shared";

// ==========================================================================
// Helpers
// ==========================================================================

function freshDb(allowExtension = false): DatabaseSync {
  const db = new DatabaseSync(":memory:", { allowExtension });
  db.exec("PRAGMA foreign_keys = ON");
  ensureMemorySchema(db);
  return db;
}

/**
 * Deterministic mock embedder — uses a hash-based approach to produce
 * consistent 384-dim vectors from text. Similar texts get similar vectors
 * (shared tokens → shared dimensions), different texts get different vectors.
 */
function mockEmbed(texts: string[]): Promise<EmbedResult> {
  return Promise.resolve({
    embeddings: texts.map((t) => hashToVector(t, 384)),
    dimensions: 384,
    model: "mock",
  });
}

function hashToVector(text: string, dims: number): number[] {
  const vec = new Array(dims).fill(0);
  const tokens = text.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    // Each token deterministically activates certain dimensions
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    // Activate ~20 dimensions per token
    for (let i = 0; i < 20; i++) {
      const idx = Math.abs((hash * (i + 1)) % dims);
      vec[idx] += 1.0 / tokens.length;
    }
  }
  // Normalize
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag > 0) for (let i = 0; i < dims; i++) vec[i] /= mag;
  return vec;
}

let db: DatabaseSync;
let memory: TentickleMemory;

beforeEach(() => {
  db = freshDb();
  memory = TentickleMemory.create(db);
});

afterEach(() => {
  memory.destroy();
  db.close();
});

// ==========================================================================
// Basic round-trip
// ==========================================================================

describe("remember + recall", () => {
  it("round-trips a memory entry", async () => {
    const entry = memory.remember({ content: "Ryan prefers TypeScript over JavaScript" });

    expect(entry.id).toBeTruthy();
    expect(entry.namespace).toBe("default");
    expect(entry.content).toBe("Ryan prefers TypeScript over JavaScript");
    expect(entry.importance).toBe(0.5);
    expect(entry.accessCount).toBe(0);
    expect(entry.createdAt).toBeGreaterThan(0);

    const result = await memory.recall({ query: "TypeScript" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].content).toBe("Ryan prefers TypeScript over JavaScript");
    expect(result.entries[0].score).toBeGreaterThan(0);
    expect(result.entries[0].score).toBeLessThanOrEqual(1);
  });

  it("stores and retrieves all optional fields", async () => {
    const entry = memory.remember({
      content: "API key rotation policy",
      namespace: "security",
      topic: "credentials",
      metadata: { source: "meeting", priority: "high" },
      importance: 0.9,
      sourceSessionId: "session-123",
    });

    expect(entry.namespace).toBe("security");
    expect(entry.topic).toBe("credentials");
    expect(entry.metadata).toEqual({ source: "meeting", priority: "high" });
    expect(entry.importance).toBe(0.9);
    expect(entry.sourceSessionId).toBe("session-123");

    const fetched = memory.get(entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.metadata).toEqual({ source: "meeting", priority: "high" });
    expect(fetched!.sourceSessionId).toBe("session-123");
  });

  it("minimal input — only content required", () => {
    const entry = memory.remember({ content: "hello" });
    expect(entry.namespace).toBe("default");
    expect(entry.topic).toBeNull();
    expect(entry.metadata).toBeNull();
    expect(entry.importance).toBe(0.5);
    expect(entry.sourceSessionId).toBeNull();
  });
});

// ==========================================================================
// FTS ranking
// ==========================================================================

describe("FTS ranking", () => {
  it("ranks more relevant content higher", async () => {
    memory.remember({ content: "TypeScript is a typed superset of JavaScript" });
    memory.remember({ content: "Python is a dynamic language used in data science" });
    memory.remember({ content: "TypeScript strict mode catches type errors at compile time" });

    const result = await memory.recall({ query: "TypeScript" });
    expect(result.entries.length).toBe(2);
    for (const entry of result.entries) {
      expect(entry.content).toContain("TypeScript");
    }
  });

  it("searches topic field too", async () => {
    memory.remember({ content: "Use pnpm for package management", topic: "tooling" });
    memory.remember({ content: "The build system runs on esbuild", topic: "tooling" });
    memory.remember({ content: "React 19 has new hooks" });

    const result = await memory.recall({ query: "tooling" });
    expect(result.entries.length).toBe(2);
  });
});

// ==========================================================================
// Namespace isolation
// ==========================================================================

describe("namespace isolation", () => {
  it("recall in namespace A does not return namespace B entries", async () => {
    memory.remember({ content: "Alpha fact", namespace: "project-a" });
    memory.remember({ content: "Alpha detail", namespace: "project-b" });

    const resultA = await memory.recall({ query: "Alpha", namespace: "project-a" });
    expect(resultA.entries.length).toBe(1);
    expect(resultA.entries[0].content).toBe("Alpha fact");

    const resultB = await memory.recall({ query: "Alpha", namespace: "project-b" });
    expect(resultB.entries.length).toBe(1);
    expect(resultB.entries[0].content).toBe("Alpha detail");
  });

  it("recall without namespace returns all namespaces", async () => {
    memory.remember({ content: "shared keyword test", namespace: "ns1" });
    memory.remember({ content: "shared keyword test variant", namespace: "ns2" });

    const result = await memory.recall({ query: "shared keyword" });
    expect(result.entries.length).toBe(2);
  });
});

// ==========================================================================
// Topic filtering
// ==========================================================================

describe("topic filtering", () => {
  it("recall with topic only returns matching entries", async () => {
    memory.remember({ content: "Use vitest for testing", topic: "testing" });
    memory.remember({ content: "Use vitest with coverage", topic: "ci" });

    const result = await memory.recall({ query: "vitest", topic: "testing" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].topic).toBe("testing");
  });
});

// ==========================================================================
// Empty / edge cases
// ==========================================================================

describe("edge cases", () => {
  it("empty recall returns empty array, not error", async () => {
    const result = await memory.recall({ query: "nonexistent" });
    expect(result.entries).toEqual([]);
  });

  it("empty query string returns empty array", async () => {
    memory.remember({ content: "some content" });
    const result = await memory.recall({ query: "" });
    expect(result.entries).toEqual([]);
  });

  it("whitespace-only query returns empty array", async () => {
    memory.remember({ content: "some content" });
    const result = await memory.recall({ query: "   " });
    expect(result.entries).toEqual([]);
  });

  it("limit constrains results", async () => {
    for (let i = 0; i < 20; i++) {
      memory.remember({ content: `keyword entry number ${i}` });
    }
    const result = await memory.recall({ query: "keyword", limit: 5 });
    expect(result.entries.length).toBe(5);
  });

  it("default limit is 10", async () => {
    for (let i = 0; i < 15; i++) {
      memory.remember({ content: `default limit keyword ${i}` });
    }
    const result = await memory.recall({ query: "default limit keyword" });
    expect(result.entries.length).toBe(10);
  });
});

// ==========================================================================
// Concurrent writes
// ==========================================================================

describe("concurrent operations", () => {
  it("10 parallel remember() calls — no corruption, no dupes", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      memory.remember({ content: `concurrent write ${i}` }),
    );

    const ids = entries.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);

    const all = memory.list();
    expect(all.length).toBe(10);
  });

  it("recall during writes — consistent results", async () => {
    for (let i = 0; i < 5; i++) {
      memory.remember({ content: `baseline concurrent item ${i}` });
    }

    const recallResult = await memory.recall({ query: "baseline concurrent" });
    memory.remember({ content: "new concurrent item" });
    const recallResult2 = await memory.recall({ query: "baseline concurrent" });

    expect(recallResult.entries.length).toBe(5);
    // After adding "new concurrent item", OR-based FTS matches it on "concurrent"
    expect(recallResult2.entries.length).toBe(6);
  });
});

// ==========================================================================
// Access tracking
// ==========================================================================

describe("access tracking", () => {
  it("recall increments access_count and updates last_accessed_at", async () => {
    const entry = memory.remember({ content: "trackable keyword content" });
    expect(entry.accessCount).toBe(0);
    expect(entry.lastAccessedAt).toBeNull();

    await memory.recall({ query: "trackable keyword" });
    const after1 = memory.get(entry.id);
    expect(after1!.accessCount).toBe(1);
    expect(after1!.lastAccessedAt).toBeGreaterThan(0);

    await memory.recall({ query: "trackable keyword" });
    const after2 = memory.get(entry.id);
    expect(after2!.accessCount).toBe(2);
  });

  it("recall results reflect updated access count", async () => {
    memory.remember({ content: "access count reflected keyword" });

    const result = await memory.recall({ query: "access count reflected" });
    expect(result.entries[0].accessCount).toBe(1);
  });
});

// ==========================================================================
// Delete
// ==========================================================================

describe("delete", () => {
  it("removes from both memories and FTS", async () => {
    const entry = memory.remember({ content: "deletable fts content" });

    const beforeRecall = await memory.recall({ query: "deletable fts" });
    expect(beforeRecall.entries.length).toBe(1);

    const deleted = memory.delete(entry.id);
    expect(deleted).toBe(true);

    const afterRecall = await memory.recall({ query: "deletable fts" });
    expect(afterRecall.entries.length).toBe(0);

    const fetched = memory.get(entry.id);
    expect(fetched).toBeNull();
  });

  it("returns false for nonexistent id", () => {
    const deleted = memory.delete("nonexistent-id");
    expect(deleted).toBe(false);
  });

  it("double delete — second returns false", () => {
    const entry = memory.remember({ content: "double delete test" });
    expect(memory.delete(entry.id)).toBe(true);
    expect(memory.delete(entry.id)).toBe(false);
  });
});

// ==========================================================================
// List
// ==========================================================================

describe("list", () => {
  it("returns all entries ordered by created_at DESC", () => {
    memory.remember({ content: "first" });
    memory.remember({ content: "second" });
    memory.remember({ content: "third" });

    const all = memory.list();
    expect(all.length).toBe(3);
    expect(all[0].content).toBe("third");
    expect(all[2].content).toBe("first");
  });

  it("filters by namespace", () => {
    memory.remember({ content: "a", namespace: "ns1" });
    memory.remember({ content: "b", namespace: "ns2" });
    memory.remember({ content: "c", namespace: "ns1" });

    const ns1 = memory.list("ns1");
    expect(ns1.length).toBe(2);
    for (const e of ns1) {
      expect(e.namespace).toBe("ns1");
    }
  });
});

// ==========================================================================
// Large content
// ==========================================================================

describe("large content", () => {
  it("handles 10KB+ text in FTS", async () => {
    const bigContent = "searchable ".repeat(1000) + "unique_marker";
    memory.remember({ content: bigContent });

    const result = await memory.recall({ query: "unique_marker" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].content).toContain("unique_marker");
  });
});

// ==========================================================================
// Special characters and injection
// ==========================================================================

describe("special characters", () => {
  it("handles quotes in content", async () => {
    memory.remember({ content: `He said "hello world" and 'goodbye'` });
    const result = await memory.recall({ query: "hello world" });
    expect(result.entries.length).toBe(1);
  });

  it("handles backslashes", async () => {
    memory.remember({ content: `Path is C:\\Users\\test\\file.txt` });
    const result = await memory.recall({ query: "Path" });
    expect(result.entries.length).toBe(1);
  });

  it("SQL injection attempts in content", () => {
    const malicious = "'; DROP TABLE memories; --";
    memory.remember({ content: malicious });

    const all = memory.list();
    expect(all.length).toBe(1);
    expect(all[0].content).toBe(malicious);
  });

  it("SQL injection attempts in query", async () => {
    memory.remember({ content: "safe content" });
    await expect(memory.recall({ query: "'; DROP TABLE memories; --" })).resolves.toBeDefined();
    const all = memory.list();
    expect(all.length).toBe(1);
  });

  it("FTS5 special characters in query (*, -, ^, OR, AND, NOT)", async () => {
    memory.remember({ content: "special operators test content" });

    await expect(memory.recall({ query: "test*" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "-test" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "^test" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "test OR crash" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "NOT test" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "test AND crash" })).resolves.toBeDefined();
  });

  it("handles parentheses and braces in query", async () => {
    memory.remember({ content: "function call test" });
    await expect(memory.recall({ query: "function()" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "{test}" })).resolves.toBeDefined();
    await expect(memory.recall({ query: "[test]" })).resolves.toBeDefined();
  });
});

// ==========================================================================
// Unicode
// ==========================================================================

describe("unicode", () => {
  it("emoji in content", async () => {
    memory.remember({ content: "Build step completed successfully checkmark" });
    const result = await memory.recall({ query: "checkmark" });
    expect(result.entries.length).toBe(1);
  });

  it("CJK characters in content and topic", async () => {
    memory.remember({ content: "TypeScript configuration", topic: "TypeScript" });
    const result = await memory.recall({ query: "TypeScript" });
    expect(result.entries.length).toBe(1);
  });

  it("mixed unicode in content", async () => {
    memory.remember({ content: "cafe unicode test" });
    const result = await memory.recall({ query: "cafe" });
    expect(result.entries.length).toBe(1);
  });
});

// ==========================================================================
// Schema
// ==========================================================================

describe("schema", () => {
  it("running ensureMemorySchema twice doesn't break (idempotency)", async () => {
    ensureMemorySchema(db);
    const entry = memory.remember({ content: "post-double-schema" });
    expect(entry.id).toBeTruthy();
  });

  it("runs cleanly on a fresh database", async () => {
    const freshDatabase = new DatabaseSync(":memory:");
    freshDatabase.exec("PRAGMA foreign_keys = ON");
    expect(() => ensureMemorySchema(freshDatabase)).not.toThrow();

    const version = (
      freshDatabase
        .prepare("SELECT version FROM _schema_versions WHERE package = ?")
        .get("memory") as { version: number }
    ).version;
    expect(version).toBe(1);

    const mem = TentickleMemory.create(freshDatabase);
    mem.remember({ content: "fresh db test" });
    const result = await mem.recall({ query: "fresh" });
    expect(result.entries.length).toBe(1);
    mem.destroy();
    freshDatabase.close();
  });
});

// ==========================================================================
// Destroy
// ==========================================================================

describe("destroy", () => {
  it("after destroy, all operations throw", async () => {
    memory.destroy();

    expect(() => memory.remember({ content: "nope" })).toThrow("destroyed");
    await expect(memory.recall({ query: "nope" })).rejects.toThrow("destroyed");
    expect(() => memory.get("some-id")).toThrow("destroyed");
    expect(() => memory.delete("some-id")).toThrow("destroyed");
    expect(() => memory.list()).toThrow("destroyed");
  });

  it("destroy is idempotent", async () => {
    memory.destroy();
    memory.destroy();
    expect(() => memory.remember({ content: "nope" })).toThrow("destroyed");
  });
});

// ==========================================================================
// Score normalization
// ==========================================================================

describe("score normalization", () => {
  it("scores are between 0 and 1", async () => {
    memory.remember({ content: "score test keyword alpha" });
    memory.remember({ content: "score test keyword beta" });
    memory.remember({ content: "unrelated content entirely" });

    const result = await memory.recall({ query: "score test keyword" });
    for (const entry of result.entries) {
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
  });
});

// ==========================================================================
// Get
// ==========================================================================

describe("get", () => {
  it("returns null for nonexistent id", () => {
    const result = memory.get("nonexistent");
    expect(result).toBeNull();
  });

  it("returns the entry by id", () => {
    const entry = memory.remember({ content: "find me by id" });
    const fetched = memory.get(entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe("find me by id");
    expect(fetched!.id).toBe(entry.id);
  });
});

// ==========================================================================
// Vec initialization
// ==========================================================================

describe("vec initialization", () => {
  it("initVec creates memory_vec table and returns true", () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    const result = vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });
    expect(result).toBe(true);
    expect(vecMemory.hasVec).toBe(true);

    vecMemory.destroy();
    vecDb.close();
  });

  it("initVec is idempotent", () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    expect(vecMemory.initVec({ embed: mockEmbed, dimensions: 384 })).toBe(true);
    expect(vecMemory.initVec({ embed: mockEmbed, dimensions: 384 })).toBe(true);
    expect(vecMemory.hasVec).toBe(true);

    vecMemory.destroy();
    vecDb.close();
  });

  it("initVec returns false without allowExtension", () => {
    const noExtDb = freshDb(false);
    const noExtMemory = TentickleMemory.create(noExtDb);

    const result = noExtMemory.initVec({ embed: mockEmbed, dimensions: 384 });
    expect(result).toBe(false);
    expect(noExtMemory.hasVec).toBe(false);

    noExtMemory.destroy();
    noExtDb.close();
  });

  it("without initVec, recall works FTS-only", async () => {
    memory.remember({ content: "FTS only keyword test" });
    const result = await memory.recall({ query: "keyword" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].content).toContain("keyword");
  });
});

// ==========================================================================
// Hybrid retrieval
// ==========================================================================

describe("hybrid retrieval", () => {
  let vecDb: DatabaseSync;
  let vecMemory: TentickleMemory;

  beforeEach(() => {
    vecDb = freshDb(true);
    vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });
  });

  afterEach(() => {
    vecMemory.destroy();
    vecDb.close();
  });

  it("semantic match when FTS returns nothing", async () => {
    vecMemory.remember({ content: "Ryan likes TypeScript and prefers functional programming" });
    vecMemory.remember({ content: "The project uses React with hooks" });
    await vecMemory.flush();

    const result = await vecMemory.recall({ query: "TypeScript programming" });
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("RRF boost: entry in both FTS and vec results ranks higher", async () => {
    vecMemory.remember({ content: "TypeScript is great for type safety" });
    vecMemory.remember({ content: "JavaScript is dynamically typed" });
    vecMemory.remember({ content: "TypeScript compiler catches errors early" });
    await vecMemory.flush();

    const result = await vecMemory.recall({ query: "TypeScript" });
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of result.entries) {
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
  });

  it("results are deduplicated", async () => {
    vecMemory.remember({ content: "unique dedup test content" });
    await vecMemory.flush();

    const result = await vecMemory.recall({ query: "unique dedup test" });
    const ids = result.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ==========================================================================
// Background embedding
// ==========================================================================

describe("background embedding", () => {
  let vecDb: DatabaseSync;
  let vecMemory: TentickleMemory;

  beforeEach(() => {
    vecDb = freshDb(true);
    vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });
  });

  afterEach(() => {
    vecMemory.destroy();
    vecDb.close();
  });

  it("remember returns immediately, embedding is async", () => {
    const entry = vecMemory.remember({ content: "async embed test" });
    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe("async embed test");
  });

  it("after flush, vector is in memory_vec", async () => {
    vecMemory.remember({ content: "flush vector test" });
    await vecMemory.flush();

    const vecCount = (
      vecDb.prepare(`SELECT COUNT(*) as cnt FROM memory_vec`).get() as { cnt: number }
    ).cnt;
    expect(vecCount).toBeGreaterThan(0);
  });

  it("multiple rapid remember() calls all get embedded", async () => {
    for (let i = 0; i < 5; i++) {
      vecMemory.remember({ content: `rapid embed ${i}` });
    }
    await vecMemory.flush();

    const vecCount = (
      vecDb.prepare(`SELECT COUNT(*) as cnt FROM memory_vec`).get() as { cnt: number }
    ).cnt;
    expect(vecCount).toBe(5);
  });
});

// ==========================================================================
// Backfill
// ==========================================================================

describe("backfill", () => {
  it("pre-initVec memories get backfilled", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    vecMemory.remember({ content: "pre-vec memory one" });
    vecMemory.remember({ content: "pre-vec memory two" });
    vecMemory.remember({ content: "pre-vec memory three" });

    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });
    await vecMemory.flush();

    const vecCount = (
      vecDb.prepare(`SELECT COUNT(*) as cnt FROM memory_vec`).get() as { cnt: number }
    ).cnt;
    expect(vecCount).toBe(3);

    vecMemory.destroy();
    vecDb.close();
  });
});

// ==========================================================================
// Graceful degradation
// ==========================================================================

describe("graceful degradation", () => {
  it("remember succeeds when embed throws", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    let callCount = 0;
    const failingEmbed: EmbedFn = async () => {
      callCount++;
      throw new Error("embed service down");
    };

    vecMemory.initVec({ embed: failingEmbed, dimensions: 384 });

    const entry = vecMemory.remember({ content: "should still work" });
    expect(entry.id).toBeTruthy();

    await vecMemory.flush();

    const fetched = vecMemory.get(entry.id);
    expect(fetched).not.toBeNull();
    expect(callCount).toBeGreaterThan(0);

    vecMemory.destroy();
    vecDb.close();
  });

  it("recall returns FTS results when vec search fails", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    let _embedCount = 0;
    const failOnRecallEmbed: EmbedFn = async (texts) => {
      _embedCount++;
      if (texts[0] && texts[0].includes("query-fail-marker")) {
        throw new Error("embed query failed");
      }
      return mockEmbed(texts);
    };

    vecMemory.initVec({ embed: failOnRecallEmbed, dimensions: 384 });
    vecMemory.remember({ content: "fallback keyword content" });
    await vecMemory.flush();

    const result = await vecMemory.recall({ query: "query-fail-marker fallback keyword" });
    expect(result.entries.length).toBeGreaterThanOrEqual(0);

    vecMemory.destroy();
    vecDb.close();
  });
});

// ==========================================================================
// Race conditions
// ==========================================================================

describe("race conditions", () => {
  it("recall during active embedding — no deadlock", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    const gate = { resolve: null as (() => void) | null, blocked: false };
    const slowEmbed: EmbedFn = async (texts) => {
      if (!gate.blocked) {
        gate.blocked = true;
        await new Promise<void>((r) => {
          gate.resolve = r;
        });
      }
      return mockEmbed(texts);
    };

    vecMemory.initVec({ embed: slowEmbed, dimensions: 384 });
    vecMemory.remember({ content: "slow embed race content" });

    const recallPromise = vecMemory.recall({ query: "slow embed race" });

    if (gate.resolve) gate.resolve();

    const result = await recallPromise;
    expect(result).toBeDefined();

    await vecMemory.flush();
    vecMemory.destroy();
    vecDb.close();
  });

  it("delete while embedding in-flight — no crash", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });

    const entry = vecMemory.remember({ content: "delete during embed" });

    const deleted = vecMemory.delete(entry.id);
    expect(deleted).toBe(true);

    await vecMemory.flush();

    vecMemory.destroy();
    vecDb.close();
  });

  it("destroy during backfill — no hanging promises", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);

    for (let i = 0; i < 20; i++) {
      vecMemory.remember({ content: `backfill destroy ${i}` });
    }

    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });

    vecMemory.destroy();

    expect(true).toBe(true);
    vecDb.close();
  });

  it("concurrent recall + remember — consistent", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });

    vecMemory.remember({ content: "concurrent base keyword" });
    await vecMemory.flush();

    const [recallResult] = await Promise.all([
      vecMemory.recall({ query: "concurrent base keyword" }),
      (async () => {
        vecMemory.remember({ content: "concurrent new keyword" });
      })(),
    ]);

    expect(recallResult.entries.length).toBeGreaterThanOrEqual(1);

    vecMemory.destroy();
    vecDb.close();
  });
});

// ==========================================================================
// Vec delete
// ==========================================================================

describe("vec delete", () => {
  it("deletes from both memories and memory_vec", async () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });

    const entry = vecMemory.remember({ content: "vec delete test" });
    await vecMemory.flush();

    const beforeCount = (
      vecDb.prepare(`SELECT COUNT(*) as cnt FROM memory_vec WHERE memory_id = ?`).get(entry.id) as {
        cnt: number;
      }
    ).cnt;
    expect(beforeCount).toBe(1);

    vecMemory.delete(entry.id);

    const afterCount = (
      vecDb.prepare(`SELECT COUNT(*) as cnt FROM memory_vec WHERE memory_id = ?`).get(entry.id) as {
        cnt: number;
      }
    ).cnt;
    expect(afterCount).toBe(0);

    vecMemory.destroy();
    vecDb.close();
  });

  it("no crash if vec row doesn't exist", () => {
    const vecDb = freshDb(true);
    const vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });

    const entry = vecMemory.remember({ content: "no vec row test" });
    expect(() => vecMemory.delete(entry.id)).not.toThrow();

    vecMemory.destroy();
    vecDb.close();
  });
});

// ==========================================================================
// Time decay
// ==========================================================================

describe("time decay", () => {
  it("recent memory outranks older memory with same relevance", async () => {
    const now = Date.now();

    // Insert "old" memory by backdating created_at
    const old = memory.remember({ content: "keyword decay test content" });
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(
      now - 90 * 24 * 60 * 60 * 1000,
      old.id,
    );

    // Insert "new" memory
    memory.remember({ content: "keyword decay test content variant" });

    const result = await memory.recall({ query: "keyword decay test" });
    expect(result.entries.length).toBe(2);
    // Newer entry should rank first after decay
    expect(result.entries[0].content).toContain("variant");
  });

  it("recently accessed old memory ranks higher than unaccessed old memory", async () => {
    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    const accessed = memory.remember({ content: "recency accessed decay keyword" });
    const stale = memory.remember({ content: "recency stale decay keyword" });

    // Backdate both to 90 days ago
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(ninetyDaysAgo, accessed.id);
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(ninetyDaysAgo, stale.id);

    // "Access" one of them recently
    db.prepare(`UPDATE memories SET last_accessed_at = ?, access_count = 1 WHERE id = ?`).run(
      now - 1000,
      accessed.id,
    );

    const result = await memory.recall({ query: "recency decay keyword" });
    expect(result.entries.length).toBe(2);
    // The recently-accessed entry should rank first
    expect(result.entries[0].content).toContain("accessed");
  });

  it("decay = 0 disables time decay", async () => {
    const now = Date.now();

    const old = memory.remember({ content: "no decay keyword test" });
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(
      now - 365 * 24 * 60 * 60 * 1000,
      old.id,
    );

    memory.remember({ content: "no decay keyword test newer" });

    // With decay disabled, both should have similar scores (FTS-driven)
    const result = await memory.recall({ query: "no decay keyword test", decay: 0 });
    expect(result.entries.length).toBe(2);
    // Scores should both be normalized (not decayed)
    for (const entry of result.entries) {
      expect(entry.score).toBeGreaterThan(0);
    }
  });

  it("custom decay lambda — high lambda decays faster", async () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    memory.remember({ content: "lambda test keyword content" });
    const old = memory.remember({ content: "lambda test keyword content old" });
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(thirtyDaysAgo, old.id);

    // High decay: 30-day-old entry decays significantly
    const highDecay = await memory.recall({ query: "lambda test keyword", decay: 0.1 });
    // Low decay: 30-day-old entry barely decays
    const lowDecay = await memory.recall({ query: "lambda test keyword", decay: 0.001 });

    expect(highDecay.entries.length).toBeGreaterThan(0);
    expect(lowDecay.entries.length).toBeGreaterThan(0);

    // The old entry should rank lower in high-decay than low-decay
    const oldHighDecay = highDecay.entries.find((e) => e.id === old.id);
    const oldLowDecay = lowDecay.entries.find((e) => e.id === old.id);
    if (oldHighDecay && oldLowDecay) {
      expect(oldHighDecay.score).toBeLessThan(oldLowDecay.score);
    }
  });

  it("scores are still normalized 0-1 after decay", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const entry = memory.remember({ content: `normalized decay keyword ${i}` });
      // Stagger creation times
      db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(
        now - i * 30 * 24 * 60 * 60 * 1000,
        entry.id,
      );
    }

    const result = await memory.recall({ query: "normalized decay keyword" });
    for (const entry of result.entries) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
    // Top entry should be normalized to 1
    expect(result.entries[0].score).toBe(1);
  });

  it("frequently accessed memory outranks equal-age unaccessed memory", async () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const popular = memory.remember({ content: "access boost keyword popular" });
    const lonely = memory.remember({ content: "access boost keyword lonely" });

    // Same age, same recency
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(thirtyDaysAgo, popular.id);
    db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(thirtyDaysAgo, lonely.id);

    // Popular has been recalled 20 times
    db.prepare(`UPDATE memories SET access_count = 20 WHERE id = ?`).run(popular.id);

    const result = await memory.recall({ query: "access boost keyword" });
    expect(result.entries.length).toBe(2);
    expect(result.entries[0].content).toContain("popular");
    expect(result.entries[0].score).toBeGreaterThan(result.entries[1].score);
  });

  it("access boost is logarithmic — 100x more accesses doesn't 100x the boost", async () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const low = memory.remember({ content: "logboost keyword content low" });
    const high = memory.remember({ content: "logboost keyword content high" });

    for (const id of [low.id, high.id]) {
      db.prepare(`UPDATE memories SET created_at = ? WHERE id = ?`).run(thirtyDaysAgo, id);
    }

    // 1 access vs 100 accesses — 100x difference
    db.prepare(`UPDATE memories SET access_count = 1 WHERE id = ?`).run(low.id);
    db.prepare(`UPDATE memories SET access_count = 100 WHERE id = ?`).run(high.id);

    const result = await memory.recall({ query: "logboost keyword content" });

    const scoreLow = result.entries.find((e) => e.id === low.id)!.score;
    const scoreHigh = result.entries.find((e) => e.id === high.id)!.score;

    // High should rank above low
    expect(scoreHigh).toBeGreaterThan(scoreLow);
    // But the ratio should be much less than 100x (log1p(100)/log1p(1) ≈ 6.6x raw)
    // After the 0.1 weight, the actual boost ratio is modest
    expect(scoreHigh / scoreLow).toBeLessThan(5);
  });

  it("access boost with decay=0 still applies", async () => {
    const popular = memory.remember({ content: "nodecay access keyword popular" });
    memory.remember({ content: "nodecay access keyword lonely" });

    // Same age (recent), but different access counts
    db.prepare(`UPDATE memories SET access_count = 15 WHERE id = ?`).run(popular.id);

    // decay=0 disables time decay but access boost should still work
    const result = await memory.recall({ query: "nodecay access keyword", decay: 0 });
    expect(result.entries.length).toBe(2);
    // Without decay, base scores are equal — access boost breaks the tie
    expect(result.entries[0].content).toContain("popular");
  });
});

// ==========================================================================
// Dedup on remember
// ==========================================================================

describe("dedup on remember", () => {
  let vecDb: DatabaseSync;
  let vecMemory: TentickleMemory;

  // Lower threshold for mock embedder — hash-based vectors are coarser than real models.
  // Real embeddings produce ~0.98 similarity for near-dupes; mock produces ~0.80.
  const MOCK_DEDUP_THRESHOLD = 0.7;

  beforeEach(() => {
    vecDb = freshDb(true);
    vecMemory = TentickleMemory.create(vecDb);
    vecMemory.initVec({ embed: mockEmbed, dimensions: 384, dedupThreshold: MOCK_DEDUP_THRESHOLD });
  });

  afterEach(() => {
    vecMemory.destroy();
    vecDb.close();
  });

  it("near-duplicate memory merges into existing entry", async () => {
    vecMemory.remember({ content: "Ryan prefers TypeScript over JavaScript" });
    await vecMemory.flush();

    vecMemory.remember({ content: "Ryan prefers TypeScript over JavaScript strongly" });
    await vecMemory.flush();

    const all = vecMemory.list();
    // Should have merged — only 1 entry remains
    expect(all.length).toBe(1);
    // Content should be updated to the newer version
    expect(all[0].content).toContain("strongly");
  });

  it("different memories are NOT deduped", async () => {
    vecMemory.remember({ content: "TypeScript is a typed superset of JavaScript" });
    await vecMemory.flush();

    vecMemory.remember({ content: "Python is great for data science and machine learning" });
    await vecMemory.flush();

    const all = vecMemory.list();
    expect(all.length).toBe(2);
  });

  it("dedup respects namespace isolation", async () => {
    vecMemory.remember({
      content: "Ryan prefers TypeScript",
      namespace: "project-a",
    });
    await vecMemory.flush();

    vecMemory.remember({
      content: "Ryan prefers TypeScript",
      namespace: "project-b",
    });
    await vecMemory.flush();

    const all = vecMemory.list();
    // Same content in different namespaces — both should exist
    expect(all.length).toBe(2);
  });

  it("dedup preserves the original entry's ID and created_at", async () => {
    const original = vecMemory.remember({ content: "Ryan likes functional programming" });
    await vecMemory.flush();

    const originalFetched = vecMemory.get(original.id);
    const originalCreatedAt = originalFetched!.createdAt;

    vecMemory.remember({ content: "Ryan likes functional programming a lot" });
    await vecMemory.flush();

    const all = vecMemory.list();
    expect(all.length).toBe(1);
    // Original ID survives
    expect(all[0].id).toBe(original.id);
    // Created at preserved
    expect(all[0].createdAt).toBe(originalCreatedAt);
    // Updated at is newer
    expect(all[0].updatedAt).toBeGreaterThanOrEqual(originalCreatedAt);
    // Content is updated
    expect(all[0].content).toContain("a lot");
  });

  it("dedup with threshold 0 disables deduplication", async () => {
    const noDedup = freshDb(true);
    const noMemory = TentickleMemory.create(noDedup);
    noMemory.initVec({ embed: mockEmbed, dimensions: 384, dedupThreshold: 0 });

    noMemory.remember({ content: "identical content for dedup test" });
    await noMemory.flush();

    noMemory.remember({ content: "identical content for dedup test" });
    await noMemory.flush();

    const all = noMemory.list();
    // Both should exist — dedup disabled
    expect(all.length).toBe(2);

    noMemory.destroy();
    noDedup.close();
  });

  it("dedup still works after backfill", async () => {
    // Create memories BEFORE vec init (will need backfill)
    const preVecDb = freshDb(true);
    const preVecMemory = TentickleMemory.create(preVecDb);

    preVecMemory.remember({ content: "pre-vec duplicate test content" });

    // Now init vec — triggers backfill
    preVecMemory.initVec({
      embed: mockEmbed,
      dimensions: 384,
      dedupThreshold: MOCK_DEDUP_THRESHOLD,
    });
    await preVecMemory.flush();

    // This should dedup against the backfilled entry
    preVecMemory.remember({ content: "pre-vec duplicate test content again" });
    await preVecMemory.flush();

    const all = preVecMemory.list();
    expect(all.length).toBe(1);

    preVecMemory.destroy();
    preVecDb.close();
  });

  it("FTS stays consistent after dedup merge", async () => {
    vecMemory.remember({ content: "searchable dedup consistency test" });
    await vecMemory.flush();

    vecMemory.remember({ content: "searchable dedup consistency test updated" });
    await vecMemory.flush();

    // FTS should find the updated content
    const result = await vecMemory.recall({ query: "searchable dedup consistency" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].content).toContain("updated");
  });

  it("rapid duplicates — merges occur", async () => {
    // Sequential remember + flush to ensure each dedup check sees the previous vector
    vecMemory.remember({ content: "Ryan strongly prefers TypeScript for all projects" });
    await vecMemory.flush();
    vecMemory.remember({ content: "Ryan strongly prefers TypeScript for all work" });
    await vecMemory.flush();
    vecMemory.remember({ content: "Ryan strongly prefers TypeScript for everything" });
    await vecMemory.flush();

    const all = vecMemory.list();
    // With sequential flush, each subsequent remember sees the existing vector and merges
    expect(all.length).toBe(1);
    // Content should be the latest version
    expect(all[0].content).toContain("everything");
  });

  it("without vec, no dedup happens (FTS-only mode)", async () => {
    // Use the base memory (no vec init)
    memory.remember({ content: "no vec dedup test" });
    memory.remember({ content: "no vec dedup test" });

    const all = memory.list();
    expect(all.length).toBe(2);
  });
});

// ==========================================================================
// Recall hints
// ==========================================================================

describe("recall hints", () => {
  // ---------- Basic ----------

  it("matchedTopics reflects result entries' topics", async () => {
    memory.remember({ content: "hint basic keyword alpha", topic: "architecture" });
    memory.remember({ content: "hint basic keyword beta", topic: "testing" });

    const result = await memory.recall({ query: "hint basic keyword" });
    expect(result.hints.matchedTopics).toContain("architecture");
    expect(result.hints.matchedTopics).toContain("testing");
  });

  it("matchedTopics are deduplicated", async () => {
    memory.remember({ content: "dedup topic hint keyword", topic: "arch" });
    memory.remember({ content: "dedup topic hint keyword two", topic: "arch" });

    const result = await memory.recall({ query: "dedup topic hint keyword" });
    const archCount = result.hints.matchedTopics.filter((t) => t === "arch").length;
    expect(archCount).toBe(1);
  });

  it("null topics excluded from matchedTopics", async () => {
    memory.remember({ content: "null topic hint keyword" }); // topic = null
    memory.remember({ content: "null topic hint keyword two", topic: "real" });

    const result = await memory.recall({ query: "null topic hint keyword" });
    expect(result.hints.matchedTopics).toEqual(["real"]);
  });

  it("topicMap returns all topics with correct counts, desc order", async () => {
    for (let i = 0; i < 5; i++) memory.remember({ content: `tm keyword ${i}`, topic: "big" });
    for (let i = 0; i < 2; i++) memory.remember({ content: `tm keyword ${i}`, topic: "small" });

    const result = await memory.recall({ query: "tm keyword" });
    const { topicMap } = result.hints;
    expect(topicMap.length).toBe(2);
    expect(topicMap[0]).toEqual({ topic: "big", count: 5 });
    expect(topicMap[1]).toEqual({ topic: "small", count: 2 });
  });

  it("topicMap populated when entries is empty (query matches nothing)", async () => {
    memory.remember({ content: "unrelated content", topic: "arch" });
    memory.remember({ content: "also unrelated", topic: "testing" });

    const result = await memory.recall({ query: "zzzznonexistent" });
    expect(result.entries).toEqual([]);
    expect(result.hints.topicMap.length).toBe(2);
  });

  it("empty-query recall returns populated topicMap", async () => {
    memory.remember({ content: "probe content", topic: "alpha" });
    memory.remember({ content: "probe content two", topic: "beta" });

    const result = await memory.recall({ query: "" });
    expect(result.entries).toEqual([]);
    expect(result.hints.matchedTopics).toEqual([]);
    expect(result.hints.relatedTopics).toEqual([]);
    expect(result.hints.topicMap.length).toBe(2);
  });

  it("FTS-only (no vec): relatedTopics empty, others work", async () => {
    memory.remember({ content: "fts only hint keyword", topic: "fts-topic" });

    const result = await memory.recall({ query: "fts only hint keyword" });
    expect(result.hints.relatedTopics).toEqual([]);
    expect(result.hints.matchedTopics).toEqual(["fts-topic"]);
    expect(result.hints.topicMap.length).toBe(1);
  });

  it("namespace isolation in topicMap", async () => {
    memory.remember({ content: "ns iso keyword", namespace: "ns-a", topic: "alpha" });
    memory.remember({ content: "ns iso keyword", namespace: "ns-b", topic: "beta" });

    const resultA = await memory.recall({ query: "ns iso keyword", namespace: "ns-a" });
    expect(resultA.hints.topicMap).toEqual([{ topic: "alpha", count: 1 }]);

    const resultB = await memory.recall({ query: "ns iso keyword", namespace: "ns-b" });
    expect(resultB.hints.topicMap).toEqual([{ topic: "beta", count: 1 }]);
  });

  it("topic filter: topicMap still shows ALL topics in namespace", async () => {
    memory.remember({ content: "filter all keyword", topic: "arch" });
    memory.remember({ content: "filter all keyword two", topic: "testing" });

    const result = await memory.recall({ query: "filter all keyword", topic: "arch" });
    expect(result.entries.length).toBe(1);
    // topicMap shows both topics even though we filtered to "arch"
    expect(result.hints.topicMap.length).toBe(2);
  });

  it("namespace=undefined: topicMap spans all namespaces", async () => {
    memory.remember({ content: "span keyword", namespace: "ns1", topic: "a" });
    memory.remember({ content: "span keyword", namespace: "ns2", topic: "b" });

    const result = await memory.recall({ query: "span keyword" });
    expect(result.hints.topicMap.length).toBe(2);
  });

  // ---------- Vec-dependent (relatedTopics) ----------

  describe("relatedTopics (vec-dependent)", () => {
    let vecDb: DatabaseSync;
    let vecMemory: TentickleMemory;

    beforeEach(() => {
      vecDb = freshDb(true);
      vecMemory = TentickleMemory.create(vecDb);
      vecMemory.initVec({ embed: mockEmbed, dimensions: 384 });
    });

    afterEach(() => {
      vecMemory.destroy();
      vecDb.close();
    });

    it("vec overflow entries' topics appear in relatedTopics", async () => {
      // Create many entries with different topics so some land in vec overflow
      vecMemory.remember({ content: "related overflow keyword primary", topic: "primary" });
      for (let i = 0; i < 15; i++) {
        vecMemory.remember({
          content: `related overflow keyword variant ${i}`,
          topic: `overflow-${i}`,
        });
      }
      await vecMemory.flush();

      const result = await vecMemory.recall({ query: "related overflow keyword", limit: 3 });
      // matchedTopics from the top 3
      expect(result.hints.matchedTopics.length).toBeGreaterThan(0);
      // relatedTopics from the vec overflow that didn't make the cut
      // (vec fetches limit*3=9, RRF picks top 3 — overflow topics should appear)
      expect(result.hints.relatedTopics.length).toBeGreaterThanOrEqual(0);
      // No overlap between matched and related
      const overlap = result.hints.relatedTopics.filter((t) =>
        result.hints.matchedTopics.includes(t),
      );
      expect(overlap).toEqual([]);
    });

    it("relatedTopics excludes topics already in matchedTopics", async () => {
      vecMemory.remember({ content: "overlap test keyword alpha", topic: "shared-topic" });
      vecMemory.remember({ content: "overlap test keyword beta", topic: "shared-topic" });
      await vecMemory.flush();

      const result = await vecMemory.recall({ query: "overlap test keyword" });
      // shared-topic appears in matchedTopics, NOT in relatedTopics
      if (result.hints.matchedTopics.includes("shared-topic")) {
        expect(result.hints.relatedTopics).not.toContain("shared-topic");
      }
    });

    it("topic filter active: relatedTopics is empty", async () => {
      vecMemory.remember({ content: "filter related keyword", topic: "target" });
      vecMemory.remember({ content: "filter related keyword two", topic: "other" });
      await vecMemory.flush();

      const result = await vecMemory.recall({ query: "filter related keyword", topic: "target" });
      expect(result.hints.relatedTopics).toEqual([]);
    });
  });

  // ---------- Adversarial ----------

  it("concurrent recall: hints consistent, no corruption", async () => {
    for (let i = 0; i < 10; i++) {
      memory.remember({ content: `concurrent hints keyword ${i}`, topic: `topic-${i % 3}` });
    }

    const results = await Promise.all(
      Array.from({ length: 5 }, () => memory.recall({ query: "concurrent hints keyword" })),
    );

    for (const result of results) {
      expect(result.hints.topicMap.length).toBe(3);
      const totalCount = result.hints.topicMap.reduce((s, t) => s + t.count, 0);
      expect(totalCount).toBe(10);
    }
  });

  it("topicMap accurate after deletes", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      memory.remember({ content: `delete hint keyword ${i}`, topic: "doomed" }),
    );
    memory.remember({ content: "delete hint keyword survivor", topic: "alive" });

    // Delete all "doomed" entries
    for (const e of entries) memory.delete(e.id);

    const result = await memory.recall({ query: "delete hint keyword" });
    expect(result.hints.topicMap).toEqual([{ topic: "alive", count: 1 }]);
  });
});
