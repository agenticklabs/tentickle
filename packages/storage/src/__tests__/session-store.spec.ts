import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { SessionSnapshot } from "@agentick/core";
import type { COMTimelineEntry } from "@agentick/core";
import type { ContentBlock } from "@agentick/shared";
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

function makeEntry(
  role: string,
  text: string,
  overrides: Partial<COMTimelineEntry> = {},
): COMTimelineEntry {
  return {
    id: randomUUID(),
    kind: "message",
    message: {
      role: role as COMTimelineEntry["message"]["role"],
      content: [{ type: "text", text } as ContentBlock],
    },
    ...overrides,
  };
}

function makeSnapshot(
  sessionId: string,
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    version: "1.0",
    sessionId,
    tick: 1,
    timeline: null,
    comState: {},
    dataCache: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

function messageCount(): number {
  return (db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }).c;
}

function blockCount(): number {
  return (db.prepare("SELECT count(*) as c FROM content_blocks").get() as { c: number }).c;
}

function tickCount(): number {
  return (db.prepare("SELECT count(*) as c FROM ticks").get() as { c: number }).c;
}

/** Ensure session row exists (required for FK constraints on executions/messages). */
function ensureSession(sessionId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, tick, version, created_at, updated_at) VALUES (?, 0, '1.0', ?, ?)",
  ).run(sessionId, Date.now(), Date.now());
}

beforeEach(() => {
  db = freshDb();
  store = new TentickleSessionStore(db);
});

afterEach(() => {
  db.close();
});

// ==========================================================================
// Contract tests (save/load via SessionStore interface)
// ==========================================================================

describe("contract tests", () => {
  it("save + load roundtrip with empty timeline", async () => {
    const snap = makeSnapshot("s1");
    await store.save("s1", snap);
    const loaded = await store.load("s1");
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe("s1");
    expect(loaded!.version).toBe("1.0");
    expect(loaded!.tick).toBe(1);
    expect(loaded!.timeline).toBeNull();
    expect(loaded!.comState).toEqual({});
    expect(loaded!.dataCache).toEqual({});
  });

  it("save + load roundtrip with timeline", async () => {
    const entries = [makeEntry("user", "Hello"), makeEntry("assistant", "Hi there!")];
    const snap = makeSnapshot("s1", { timeline: entries, tick: 2 });
    await store.save("s1", snap);

    const loaded = await store.load("s1");
    expect(loaded!.timeline).not.toBeNull();
    expect(loaded!.timeline!.length).toBe(2);
    expect(loaded!.timeline![0].message.role).toBe("user");
    expect((loaded!.timeline![0].message.content[0] as { text: string }).text).toBe("Hello");
    expect(loaded!.timeline![1].message.role).toBe("assistant");
  });

  it("save overwrites session metadata (tick)", async () => {
    await store.save("s1", makeSnapshot("s1", { tick: 1 }));
    await store.save("s1", makeSnapshot("s1", { tick: 5 }));

    const loaded = await store.load("s1");
    expect(loaded!.tick).toBe(5);
  });

  it("save is incremental — new messages only", async () => {
    const e1 = makeEntry("user", "First");
    await store.save("s1", makeSnapshot("s1", { timeline: [e1] }));
    expect(messageCount()).toBe(1);

    const e2 = makeEntry("assistant", "Second");
    await store.save("s1", makeSnapshot("s1", { timeline: [e1, e2], tick: 2 }));
    expect(messageCount()).toBe(2);
  });

  it("delete removes session + cascades to messages/blocks/snapshots", async () => {
    const entry = makeEntry("user", "Hello");
    await store.save(
      "s1",
      makeSnapshot("s1", {
        timeline: [entry],
        comState: { key: "value" },
      }),
    );
    expect(messageCount()).toBe(1);
    expect(blockCount()).toBeGreaterThan(0);

    await store.delete("s1");

    expect(messageCount()).toBe(0);
    expect(blockCount()).toBe(0);
    expect(await store.has("s1")).toBe(false);
  });

  it("list returns sessions newest-first", async () => {
    await store.save("s1", makeSnapshot("s1"));
    await new Promise((r) => setTimeout(r, 5));
    await store.save("s2", makeSnapshot("s2"));

    const ids = await store.list();
    expect(ids[0]).toBe("s2");
    expect(ids[1]).toBe("s1");
  });

  it("has returns true/false correctly", async () => {
    expect(await store.has("nonexistent")).toBe(false);
    await store.save("s1", makeSnapshot("s1"));
    expect(await store.has("s1")).toBe(true);
  });

  it("load returns null for missing session", async () => {
    expect(await store.load("nonexistent")).toBeNull();
  });

  it("empty comState roundtrip", async () => {
    await store.save("s1", makeSnapshot("s1", { comState: {} }));
    const loaded = await store.load("s1");
    expect(loaded!.comState).toEqual({});
  });

  it("load returns empty dataCache (not persisted)", async () => {
    await store.save("s1", makeSnapshot("s1"));
    const loaded = await store.load("s1");
    expect(loaded!.dataCache).toEqual({});
  });
});

// ==========================================================================
// Incremental persistence (commitEntry)
// ==========================================================================

describe("commitEntry", () => {
  it("persists message + content_blocks rows", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const entry = makeEntry("user", "Hello world");
    store.commitEntry("s1", entry, "e1", 0, 0);

    expect(messageCount()).toBe(1);
    expect(blockCount()).toBe(1);

    const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(entry.id!) as any;
    expect(msg.session_id).toBe("s1");
    expect(msg.execution_id).toBe("e1");
    expect(msg.role).toBe("user");
    expect(msg.tick).toBe(0);
    expect(msg.sequence_in_tick).toBe(0);
  });

  it("is idempotent — twice with same ID produces no duplicates", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const entry = makeEntry("user", "Hello");
    store.commitEntry("s1", entry, "e1", 0, 0);
    store.commitEntry("s1", entry, "e1", 0, 0);

    expect(messageCount()).toBe(1);
  });

  it("uses correct tick from event, not session tick", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");
    store.recordTickStart("e1", 3);

    const entry = makeEntry("assistant", "Response");
    store.commitEntry("s1", entry, "e1", 3, 5);

    const msg = db
      .prepare("SELECT tick, sequence_in_tick FROM messages WHERE id = ?")
      .get(entry.id!) as any;
    expect(msg.tick).toBe(3);
    expect(msg.sequence_in_tick).toBe(5);
  });

  it("links message to execution via FK", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const entry = makeEntry("user", "Test");
    store.commitEntry("s1", entry, "e1", 0, 0);

    const msg = db.prepare("SELECT execution_id FROM messages WHERE id = ?").get(entry.id!) as any;
    expect(msg.execution_id).toBe("e1");
  });

  it("save() after commitEntry — no duplicate messages", async () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const entry = makeEntry("user", "Incremental");
    store.commitEntry("s1", entry, "e1", 0, 0);
    expect(messageCount()).toBe(1);

    // save() with the same timeline should not duplicate
    await store.save("s1", makeSnapshot("s1", { timeline: [entry], tick: 1 }));
    expect(messageCount()).toBe(1);
  });

  it("load() after incremental persist reconstructs timeline", async () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const e1 = makeEntry("user", "Question");
    const e2 = makeEntry("assistant", "Answer");
    store.commitEntry("s1", e1, "e1", 0, 0);
    store.commitEntry("s1", e2, "e1", 0, 1);

    // Update session row so load finds it
    await store.save("s1", makeSnapshot("s1", { tick: 1, timeline: [e1, e2] }));

    const loaded = await store.load("s1");
    expect(loaded!.timeline!.length).toBe(2);
    expect(loaded!.timeline![0].message.role).toBe("user");
    expect(loaded!.timeline![1].message.role).toBe("assistant");
  });
});

// ==========================================================================
// Content blocks subquery scale test
// ==========================================================================

describe("content blocks subquery", () => {
  it("500+ messages loads correctly via subquery", async () => {
    const entries: COMTimelineEntry[] = [];
    for (let i = 0; i < 500; i++) {
      entries.push(makeEntry(i % 2 === 0 ? "user" : "assistant", `Msg ${i}`));
    }

    await store.save("s1", makeSnapshot("s1", { timeline: entries, tick: 250 }));
    expect(messageCount()).toBe(500);

    const loaded = await store.load("s1");
    expect(loaded!.timeline!.length).toBe(500);
    // Verify first and last messages
    expect((loaded!.timeline![0].message.content[0] as { text: string }).text).toBe("Msg 0");
    expect((loaded!.timeline![499].message.content[0] as { text: string }).text).toBe("Msg 499");
  });
});

// ==========================================================================
// Execution tracking
// ==========================================================================

describe("execution tracking", () => {
  it("createExecution + completeExecution roundtrip", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const exec = db.prepare("SELECT * FROM executions WHERE id = ?").get("e1") as any;
    expect(exec.status).toBe("running");
    expect(exec.session_id).toBe("s1");
    expect(exec.trigger_type).toBe("send");

    store.completeExecution("e1", "completed", 3);

    const updated = db.prepare("SELECT * FROM executions WHERE id = ?").get("e1") as any;
    expect(updated.status).toBe("completed");
    expect(updated.tick_count).toBe(3);
    expect(updated.completed_at).not.toBeNull();
  });

  it("completeExecution with error", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");
    store.completeExecution("e1", "failed", 1, "Model returned error");

    const exec = db.prepare("SELECT * FROM executions WHERE id = ?").get("e1") as any;
    expect(exec.status).toBe("failed");
    expect(exec.error).toBe("Model returned error");
  });

  it("messages linked to execution via FK", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const entry = makeEntry("user", "linked");
    store.commitEntry("s1", entry, "e1", 0, 0);

    const msgs = db
      .prepare("SELECT id, execution_id FROM messages WHERE execution_id = ?")
      .all("e1") as any[];
    expect(msgs.length).toBe(1);
    expect(msgs[0].execution_id).toBe("e1");
  });
});

// ==========================================================================
// Tick tracking
// ==========================================================================

describe("tick tracking", () => {
  it("recordTickStart + recordTickEnd roundtrip", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");
    store.recordTickStart("e1", 0);

    const tick = db
      .prepare("SELECT * FROM ticks WHERE execution_id = ? AND tick_number = ?")
      .get("e1", 0) as any;
    expect(tick.started_at).not.toBeNull();
    expect(tick.completed_at).toBeNull();

    store.recordTickEnd("e1", 0, "gpt-4o", { inputTokens: 100, outputTokens: 50 }, "end_turn");

    const updated = db
      .prepare("SELECT * FROM ticks WHERE execution_id = ? AND tick_number = ?")
      .get("e1", 0) as any;
    expect(updated.model).toBe("gpt-4o");
    expect(JSON.parse(updated.usage)).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(updated.stop_reason).toBe("end_turn");
    expect(updated.completed_at).not.toBeNull();
  });

  it("multi-tick execution with different models per tick", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    store.recordTickStart("e1", 0);
    store.recordTickEnd("e1", 0, "gpt-4o", { inputTokens: 100, outputTokens: 50 }, "tool_use");

    store.recordTickStart("e1", 1);
    store.recordTickEnd(
      "e1",
      1,
      "claude-3-opus",
      { inputTokens: 200, outputTokens: 100 },
      "end_turn",
    );

    const ticks = db
      .prepare("SELECT model FROM ticks WHERE execution_id = ? ORDER BY tick_number")
      .all("e1") as any[];
    expect(ticks[0].model).toBe("gpt-4o");
    expect(ticks[1].model).toBe("claude-3-opus");
  });

  it("usage aggregation across ticks matches expected totals", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    store.recordTickStart("e1", 0);
    store.recordTickEnd("e1", 0, "m1", { inputTokens: 100, outputTokens: 50 }, "tool_use");
    store.recordTickStart("e1", 1);
    store.recordTickEnd("e1", 1, "m1", { inputTokens: 200, outputTokens: 75 }, "end_turn");

    const agg = db
      .prepare(
        `SELECT
           SUM(json_extract(usage, '$.inputTokens')) as total_input,
           SUM(json_extract(usage, '$.outputTokens')) as total_output
         FROM ticks WHERE execution_id = ?`,
      )
      .get("e1") as any;

    expect(agg.total_input).toBe(300);
    expect(agg.total_output).toBe(125);
  });

  it("ticks cascade on execution delete", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");
    store.recordTickStart("e1", 0);
    store.recordTickStart("e1", 1);

    expect(tickCount()).toBe(2);

    db.prepare("DELETE FROM executions WHERE id = ?").run("e1");

    expect(tickCount()).toBe(0);
  });
});

// ==========================================================================
// comState via session_snapshots
// ==========================================================================

describe("comState via session_snapshots", () => {
  it("save + load roundtrip", async () => {
    const comState = { a: 1, b: "hello", c: [1, 2, 3] };
    await store.save("s1", makeSnapshot("s1", { comState }));
    const loaded = await store.load("s1");
    expect(loaded!.comState).toEqual(comState);
  });

  it("save overwrites previous comState completely", async () => {
    await store.save("s1", makeSnapshot("s1", { comState: { a: 1, b: 2 }, tick: 1 }));
    await store.save("s1", makeSnapshot("s1", { comState: { b: 99, c: 3 }, tick: 2 }));

    const loaded = await store.load("s1");
    expect(loaded!.comState).toEqual({ b: 99, c: 3 });
    expect(loaded!.comState).not.toHaveProperty("a");
  });

  it("deeply nested state roundtrips", async () => {
    const comState = {
      simple: "value",
      number: 42,
      nested: {
        deep: {
          deeper: {
            deepest: [1, 2, { key: "value", arr: [true, false, null] }],
          },
        },
      },
      array: [1, "two", { three: 3 }],
      nullValue: null,
      bool: true,
    };

    await store.save("s1", makeSnapshot("s1", { comState }));
    const loaded = await store.load("s1");
    expect(loaded!.comState).toEqual(comState);
  });
});

// ==========================================================================
// Adversarial tests
// ==========================================================================

describe("adversarial: parallel commitEntry calls", () => {
  it("10 parallel commitEntry calls — no duplicates", () => {
    ensureSession("s1");
    store.createExecution("e1", "s1", "send");

    const entries = Array.from({ length: 10 }, (_, i) => makeEntry("user", `Msg ${i}`));

    for (let i = 0; i < entries.length; i++) {
      store.commitEntry("s1", entries[i], "e1", 0, i);
    }

    expect(messageCount()).toBe(10);

    // Call again — idempotent
    for (let i = 0; i < entries.length; i++) {
      store.commitEntry("s1", entries[i], "e1", 0, i);
    }

    expect(messageCount()).toBe(10);
  });
});

describe("adversarial: large timeline", () => {
  it("200-message timeline — incremental save, all persisted", async () => {
    const entries: COMTimelineEntry[] = [];
    for (let i = 0; i < 200; i++) {
      entries.push(makeEntry(i % 2 === 0 ? "user" : "assistant", `Message ${i}`));
    }

    await store.save("s1", makeSnapshot("s1", { timeline: entries, tick: 100 }));
    expect(messageCount()).toBe(200);

    const loaded = await store.load("s1");
    expect(loaded!.timeline!.length).toBe(200);

    for (let i = 200; i < 210; i++) {
      entries.push(makeEntry("user", `Message ${i}`));
    }
    await store.save("s1", makeSnapshot("s1", { timeline: entries, tick: 105 }));
    expect(messageCount()).toBe(210);
  });
});

describe("adversarial: concurrent saves to different sessions", () => {
  it("parallel saves don't interfere", async () => {
    const saves = Array.from({ length: 10 }, (_, i) => {
      const sid = `session-${i}`;
      return store.save(
        sid,
        makeSnapshot(sid, {
          timeline: [makeEntry("user", `Message for session ${i}`)],
        }),
      );
    });
    await Promise.all(saves);

    const ids = await store.list();
    expect(ids.length).toBe(10);

    for (let i = 0; i < 10; i++) {
      const loaded = await store.load(`session-${i}`);
      expect(loaded).not.toBeNull();
      expect(loaded!.timeline!.length).toBe(1);
    }
  });
});
