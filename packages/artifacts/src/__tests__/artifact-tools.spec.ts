import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { extractText } from "@agentick/shared";
import type { ToolClass } from "@agentick/core";
import { ArtifactStore } from "../artifact-store.js";
import { ensureArtifactSchema } from "../schema.js";
import {
  createStoreArtifactTool,
  createGetArtifactTool,
  createListArtifactsTool,
} from "../tools/artifacts.js";

// ==========================================================================
// Helpers
// ==========================================================================

function freshStore(): { db: DatabaseSync; store: ArtifactStore } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  ensureArtifactSchema(db);
  return { db, store: ArtifactStore.create(db) };
}

async function run(tool: ToolClass, input: any) {
  const handle = await tool.run!(input);
  return handle.result;
}

function text(result: any): string {
  return extractText(result);
}

// ==========================================================================
// createStoreArtifactTool
// ==========================================================================

describe("createStoreArtifactTool", () => {
  let db: DatabaseSync;
  let store: ArtifactStore;

  beforeEach(() => {
    ({ db, store } = freshStore());
  });

  afterEach(() => {
    store.destroy();
    db.close();
  });

  it("stores an artifact and returns confirmation with ID", async () => {
    const tool = createStoreArtifactTool(store);
    const result = await run(tool, {
      name: "auth-analysis",
      type: "analysis",
      content: "JWT with rotating refresh tokens",
      summary: "Auth overview",
    });

    const output = text(result);
    expect(output).toContain("Stored artifact");
    expect(output).toContain("auth-analysis");
    expect(output).toContain("(analysis)");

    // Verify actually persisted
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("auth-analysis");
    expect(all[0].content).toBe("JWT with rotating refresh tokens");
    expect(all[0].summary).toBe("Auth overview");
  });

  it("stores without session ID when called via static .run() (no ctx)", async () => {
    const tool = createStoreArtifactTool(store);
    await run(tool, {
      name: "orphan",
      type: "code",
      content: "function f() {}",
    });

    const entry = store.getByName("orphan");
    expect(entry).not.toBeNull();
    expect(entry!.sessionId).toBeNull();
  });

  it("stores without summary when not provided", async () => {
    const tool = createStoreArtifactTool(store);
    await run(tool, {
      name: "no-summary",
      type: "document",
      content: "just content",
    });

    const entry = store.getByName("no-summary");
    expect(entry!.summary).toBeNull();
  });
});

// ==========================================================================
// createGetArtifactTool
// ==========================================================================

describe("createGetArtifactTool", () => {
  let db: DatabaseSync;
  let store: ArtifactStore;

  beforeEach(() => {
    ({ db, store } = freshStore());
  });

  afterEach(() => {
    store.destroy();
    db.close();
  });

  it("retrieves an artifact by ID", async () => {
    const entry = store.store({ name: "plan", type: "plan", content: "Step 1: win" });
    const tool = createGetArtifactTool(store);
    const result = await run(tool, { id: entry.id });

    const parsed = JSON.parse(text(result));
    expect(parsed.name).toBe("plan");
    expect(parsed.content).toBe("Step 1: win");
  });

  it("retrieves an artifact by name", async () => {
    store.store({ name: "schema", type: "schema", content: "CREATE TABLE..." });
    const tool = createGetArtifactTool(store);
    const result = await run(tool, { name: "schema" });

    const parsed = JSON.parse(text(result));
    expect(parsed.name).toBe("schema");
    expect(parsed.type).toBe("schema");
  });

  it("returns 'not found' for missing ID", async () => {
    const tool = createGetArtifactTool(store);
    const result = await run(tool, { id: "nonexistent" });
    expect(text(result)).toBe("Artifact not found.");
  });

  it("returns 'not found' for missing name", async () => {
    const tool = createGetArtifactTool(store);
    const result = await run(tool, { name: "ghost" });
    expect(text(result)).toBe("Artifact not found.");
  });

  it("returns 'not found' when neither id nor name provided", async () => {
    const tool = createGetArtifactTool(store);
    const result = await run(tool, {});
    expect(text(result)).toBe("Artifact not found.");
  });

  it("prefers ID over name when both provided", async () => {
    const entry = store.store({ name: "by-id", type: "code", content: "correct" });
    store.store({ name: "by-name", type: "code", content: "wrong" });

    const tool = createGetArtifactTool(store);
    const result = await run(tool, { id: entry.id, name: "by-name" });

    const parsed = JSON.parse(text(result));
    expect(parsed.content).toBe("correct");
  });

  it("includes all expected fields in response", async () => {
    store.store({
      name: "full",
      type: "analysis",
      content: "detailed analysis",
      summary: "brief",
    });

    const tool = createGetArtifactTool(store);
    const result = await run(tool, { name: "full" });
    const parsed = JSON.parse(text(result));

    expect(parsed).toEqual({
      id: expect.any(String),
      name: "full",
      type: "analysis",
      summary: "brief",
      content: "detailed analysis",
    });
  });
});

// ==========================================================================
// createListArtifactsTool
// ==========================================================================

describe("createListArtifactsTool", () => {
  let db: DatabaseSync;
  let store: ArtifactStore;

  beforeEach(() => {
    ({ db, store } = freshStore());
  });

  afterEach(() => {
    store.destroy();
    db.close();
  });

  it("lists all artifacts", async () => {
    store.store({ name: "alpha", type: "code", content: "a" });
    store.store({ name: "beta", type: "document", content: "b" });

    const tool = createListArtifactsTool(store);
    const result = await run(tool, {});
    const output = text(result);

    expect(output).toContain("alpha (code)");
    expect(output).toContain("beta (document)");
  });

  it("filters by type", async () => {
    store.store({ name: "fn", type: "code", content: "x" });
    store.store({ name: "readme", type: "document", content: "y" });
    store.store({ name: "util", type: "code", content: "z" });

    const tool = createListArtifactsTool(store);
    const result = await run(tool, { type: "code" });
    const output = text(result);

    expect(output).toContain("fn (code)");
    expect(output).toContain("util (code)");
    expect(output).not.toContain("readme");
  });

  it("returns 'No artifacts found.' when empty", async () => {
    const tool = createListArtifactsTool(store);
    const result = await run(tool, {});
    expect(text(result)).toBe("No artifacts found.");
  });

  it("includes summary in listing when present", async () => {
    store.store({
      name: "plan",
      type: "plan",
      content: "long content...",
      summary: "migration strategy",
    });

    const tool = createListArtifactsTool(store);
    const result = await run(tool, {});
    const output = text(result);

    expect(output).toContain("plan (plan)");
    expect(output).toContain("migration strategy");
  });

  it("truncates IDs to 8 characters in listing", async () => {
    const entry = store.store({ name: "test", type: "code", content: "x" });

    const tool = createListArtifactsTool(store);
    const result = await run(tool, {});
    const output = text(result);

    expect(output).toContain(`[${entry.id.slice(0, 8)}]`);
    expect(output).not.toContain(entry.id);
  });
});
