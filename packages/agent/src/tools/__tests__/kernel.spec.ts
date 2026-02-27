import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { extractText } from "@agentick/shared";
import type { ToolClass } from "@agentick/core";
import {
  createKernelDelegateTool,
  createWorkersTool,
  createCancelTool,
  createSendWorkerTool,
} from "../kernel.js";
import { ArtifactStore, ensureArtifactSchema, bindArtifactStore } from "@tentickle/artifacts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockChannel() {
  const subscribers = new Set<(event: any) => void>();
  return {
    subscribe: (fn: any) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    publish: (event: any) => {
      for (const fn of subscribers) fn(event);
    },
  };
}

type SessionLike = {
  id: string;
  status: string;
  metadata: Readonly<Record<string, unknown>>;
};

function workerSession(id: string, origin: string, task: string, status = "running"): SessionLike {
  return {
    id,
    status,
    metadata: Object.freeze({ type: "worker", origin, task }),
  };
}

function shellSession(id: string, status = "idle"): SessionLike {
  return {
    id,
    status,
    metadata: Object.freeze({ type: "shell" }),
  };
}

function mockApp(sessions: SessionLike[]) {
  const map = new Map(sessions.map((s) => [s.id, s]));
  return {
    sessions: Array.from(map.keys()),
    getSession: (id: string) => map.get(id),
    close: vi.fn(async () => {}),
    receive: vi.fn(async () => {}),
  } as any;
}

/** Run a tool handler and return the ContentBlock[] result. */
async function run(tool: ToolClass, input: any) {
  const handle = await tool.run!(input);
  return handle.result;
}

/** Extract text from a tool result. */
function text(result: any): string {
  return extractText(result);
}

// ---------------------------------------------------------------------------
// createWorkersTool
// ---------------------------------------------------------------------------

describe("createWorkersTool", () => {
  const OWNER = "shell-1";

  it("returns only workers owned by this session", async () => {
    const app = mockApp([
      workerSession("w-1", OWNER, "fix bug"),
      workerSession("w-2", "other-shell", "other task"),
      shellSession(OWNER),
    ]);

    const tool = createWorkersTool(app, OWNER);
    const result = await run(tool, {});

    expect(text(result)).toContain("fix bug");
    expect(text(result)).not.toContain("other task");
  });

  it("excludes closed workers by default", async () => {
    const app = mockApp([
      workerSession("w-1", OWNER, "still running", "running"),
      workerSession("w-2", OWNER, "already done", "closed"),
    ]);

    const tool = createWorkersTool(app, OWNER);
    const result = await run(tool, {});
    const output = text(result);

    expect(output).toContain("still running");
    expect(output).not.toContain("already done");
  });

  it("includeCompleted=true shows closed workers", async () => {
    const app = mockApp([
      workerSession("w-1", OWNER, "still running", "running"),
      workerSession("w-2", OWNER, "already done", "closed"),
    ]);

    const tool = createWorkersTool(app, OWNER);
    const result = await run(tool, { includeCompleted: true });
    const output = text(result);

    expect(output).toContain("still running");
    expect(output).toContain("already done");
  });

  it("returns 'No workers found.' when no workers match", async () => {
    const app = mockApp([shellSession(OWNER)]);

    const tool = createWorkersTool(app, OWNER);
    const result = await run(tool, {});

    expect(text(result)).toBe("No workers found.");
  });

  it("excludes non-worker sessions", async () => {
    const app = mockApp([
      shellSession(OWNER),
      shellSession("shell-2"),
      workerSession("w-1", OWNER, "only worker"),
    ]);

    const tool = createWorkersTool(app, OWNER);
    const output = text(await run(tool, {}));

    expect(output).not.toContain("shell");
    expect(output).toContain("only worker");
  });

  it("does not expose workers from other sessions", async () => {
    const app = mockApp([
      workerSession("w-1", "other-shell", "secret task"),
      workerSession("w-2", "other-shell", "hidden task", "closed"),
    ]);

    const tool = createWorkersTool(app, OWNER);

    // Neither default nor includeCompleted should reveal other sessions' workers
    expect(text(await run(tool, {}))).toBe("No workers found.");
    expect(text(await run(tool, { includeCompleted: true }))).toBe("No workers found.");
  });

  it("truncates session IDs to first 8 characters", async () => {
    const longId = "abcdef1234567890";
    const app = mockApp([workerSession(longId, OWNER, "task")]);

    const tool = createWorkersTool(app, OWNER);
    const result = await run(tool, {});
    const output = text(result);

    expect(output).toContain("[abcdef12]");
    expect(output).not.toContain(longId);
  });
});

// ---------------------------------------------------------------------------
// createCancelTool
// ---------------------------------------------------------------------------

describe("createCancelTool", () => {
  const OWNER = "shell-1";

  it("cancels a worker session via app.close", async () => {
    const app = mockApp([workerSession("w-1", OWNER, "task")]);
    const tool = createCancelTool(app, OWNER);

    const result = await run(tool, { workerId: "w-1" });

    expect(text(result)).toContain("cancelled");
    expect(app.close).toHaveBeenCalledWith("w-1");
  });

  it("returns error for unknown session ID", async () => {
    const app = mockApp([]);
    const tool = createCancelTool(app, OWNER);

    const result = await run(tool, { workerId: "nonexistent" });

    expect(text(result)).toContain("not found");
    expect(app.close).not.toHaveBeenCalled();
  });

  it("rejects cancellation of non-worker sessions", async () => {
    const app = mockApp([shellSession("shell-1")]);
    const tool = createCancelTool(app, OWNER);

    const result = await run(tool, { workerId: "shell-1" });

    expect(text(result)).toContain("not a worker");
    expect(app.close).not.toHaveBeenCalled();
  });

  it("rejects cancellation of worker owned by different session", async () => {
    const app = mockApp([workerSession("w-1", "other-shell", "task")]);
    const tool = createCancelTool(app, OWNER);

    const result = await run(tool, { workerId: "w-1" });

    expect(text(result)).toContain("not owned by this session");
    expect(app.close).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createSendWorkerTool
// ---------------------------------------------------------------------------

describe("createSendWorkerTool", () => {
  const OWNER = "shell-1";

  it("sends a role:user message to a worker via app.receive", async () => {
    const app = mockApp([workerSession("w-1", OWNER, "task")]);
    const tool = createSendWorkerTool(app, OWNER);

    const result = await run(tool, {
      workerId: "w-1",
      message: "update status please",
    });

    expect(text(result)).toContain("Message sent");
    expect(app.receive).toHaveBeenCalledWith(
      "w-1",
      expect.objectContaining({
        source: "shell",
        type: "message",
        payload: expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "update status please" }),
          ]),
        }),
      }),
    );
  });

  it("returns error for unknown session ID", async () => {
    const app = mockApp([]);
    const tool = createSendWorkerTool(app, OWNER);

    const result = await run(tool, {
      workerId: "ghost",
      message: "hello",
    });

    expect(text(result)).toContain("not found");
    expect(app.receive).not.toHaveBeenCalled();
  });

  it("rejects sending to non-worker sessions", async () => {
    const app = mockApp([shellSession("shell-1")]);
    const tool = createSendWorkerTool(app, OWNER);

    const result = await run(tool, {
      workerId: "shell-1",
      message: "hello",
    });

    expect(text(result)).toContain("not a worker");
    expect(app.receive).not.toHaveBeenCalled();
  });

  it("rejects sending to worker owned by different session", async () => {
    const app = mockApp([workerSession("w-1", "other-shell", "task")]);
    const tool = createSendWorkerTool(app, OWNER);

    const result = await run(tool, {
      workerId: "w-1",
      message: "hello",
    });

    expect(text(result)).toContain("not owned by this session");
    expect(app.receive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createKernelDelegateTool
// ---------------------------------------------------------------------------

describe("createKernelDelegateTool", () => {
  const OWNER_ID = "shell-1";

  function createDelegateMocks(workerResult: { response: string } | Error = { response: "done" }) {
    const channels = new Map<string, ReturnType<typeof createMockChannel>>();
    function getChannel(name: string) {
      if (!channels.has(name)) channels.set(name, createMockChannel());
      return channels.get(name)!;
    }

    const ownerSession = Object.assign(new EventEmitter(), {
      id: OWNER_ID,
      pushEvent: vi.fn((event: any) => {
        ownerSession.emit("event", event);
      }),
      channel: vi.fn(getChannel),
    });

    const isError = workerResult instanceof Error;
    const resultPromise = isError ? Promise.reject(workerResult) : Promise.resolve(workerResult);
    resultPromise.catch(() => {});

    const mockWorkerSession = Object.assign(new EventEmitter(), {
      id: "worker-abc",
      send: vi.fn().mockImplementation(() => {
        const handle = { result: resultPromise };
        return Object.assign(Promise.resolve(handle), { result: resultPromise });
      }),
      channel: vi.fn(getChannel),
      metadata: Object.freeze({
        type: "worker",
        origin: OWNER_ID,
        task: "test task",
      }),
    });

    const app = {
      session: vi.fn(async (arg: any) => {
        if (typeof arg === "string") return ownerSession;
        return mockWorkerSession;
      }),
      receive: vi.fn(async () => {}),
    } as any;

    return { app, ownerSession, workerSession: mockWorkerSession };
  }

  it("creates a worker session with correct metadata", async () => {
    const { app } = createDelegateMocks();
    const tool = createKernelDelegateTool(app, OWNER_ID);

    await run(tool, {
      task: "fix the tests",
      spec: "Run vitest and fix failures",
    });

    expect(app.session).toHaveBeenCalledWith(OWNER_ID);
    expect(app.session).toHaveBeenCalledWith({
      parentSessionId: OWNER_ID,
      metadata: {
        type: "worker",
        origin: OWNER_ID,
        task: "fix the tests",
      },
    });
  });

  it("returns the worker session ID and task in result text", async () => {
    const { app } = createDelegateMocks();
    const tool = createKernelDelegateTool(app, OWNER_ID);

    const result = await run(tool, {
      task: "fix the tests",
      spec: "Run vitest and fix failures",
    });
    const output = text(result);

    expect(output).toContain("worker-abc");
    expect(output).toContain("fix the tests");
  });

  it("sends the spec as a user message to the worker", async () => {
    const { app, workerSession: ws } = createDelegateMocks();
    const tool = createKernelDelegateTool(app, OWNER_ID);

    await run(tool, {
      task: "fix the tests",
      spec: "Run vitest and fix failures",
    });

    expect(ws.send).toHaveBeenCalledWith({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Run vitest and fix failures" }],
        },
      ],
    });
  });

  it("delivers completion notification with role:event and eventType", async () => {
    const { app } = createDelegateMocks({ response: "all green" });
    const tool = createKernelDelegateTool(app, OWNER_ID);

    await run(tool, { task: "test run", spec: "run it" });

    await vi.waitFor(() => {
      expect(app.receive).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({
          source: "worker",
          type: "message",
          payload: expect.objectContaining({
            role: "event",
            eventType: "worker_completion",
            content: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining("[Worker Complete]"),
              }),
            ]),
          }),
        }),
      );
    });
  });

  it("delivers failure notification with role:event and eventType", async () => {
    const { app } = createDelegateMocks(new Error("segfault"));
    const tool = createKernelDelegateTool(app, OWNER_ID);

    await run(tool, { task: "risky op", spec: "do it" });

    await vi.waitFor(() => {
      expect(app.receive).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({
          source: "worker",
          type: "message",
          payload: expect.objectContaining({
            role: "event",
            eventType: "worker_failure",
            content: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining("[Worker Failed]"),
              }),
            ]),
          }),
        }),
      );
    });

    await vi.waitFor(() => {
      const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
      expect(receivedText).toContain("segfault");
    });
  });

  it("truncates long worker responses in the completion notification", async () => {
    const longResponse = "x".repeat(3000);
    const { app } = createDelegateMocks({ response: longResponse });
    const tool = createKernelDelegateTool(app, OWNER_ID);

    await run(tool, { task: "verbose task", spec: "do it" });

    await vi.waitFor(() => {
      expect(app.receive).toHaveBeenCalled();
    });

    const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
    // The handler slices to 2000 chars
    expect(receivedText.length).toBeLessThan(longResponse.length);
  });

  it("pipes confirmations between worker and owner sessions", async () => {
    // Use a deferred promise so the worker result doesn't resolve immediately.
    // If it resolved immediately, unpipe() would be called before we can emit events.
    let resolveWorker!: (value: { response: string }) => void;
    const deferredResult = new Promise<{ response: string }>((resolve) => {
      resolveWorker = resolve;
    });

    const channels = new Map<string, ReturnType<typeof createMockChannel>>();
    function getChannel(name: string) {
      if (!channels.has(name)) channels.set(name, createMockChannel());
      return channels.get(name)!;
    }

    const ownerSession = Object.assign(new EventEmitter(), {
      id: OWNER_ID,
      pushEvent: vi.fn((event: any) => {
        ownerSession.emit("event", event);
      }),
      channel: vi.fn(getChannel),
    });

    const ws = Object.assign(new EventEmitter(), {
      id: "worker-abc",
      send: vi.fn().mockImplementation(() => {
        const handle = { result: deferredResult };
        return Object.assign(Promise.resolve(handle), { result: deferredResult });
      }),
      channel: vi.fn(getChannel),
      metadata: Object.freeze({ type: "worker", origin: OWNER_ID, task: "test" }),
    });

    const app = {
      session: vi.fn(async (arg: any) => {
        if (typeof arg === "string") return ownerSession;
        return ws;
      }),
      receive: vi.fn(async () => {}),
    } as any;

    const tool = createKernelDelegateTool(app, OWNER_ID);
    await run(tool, { task: "confirm test", spec: "do it" });

    // Listener should still be active since worker hasn't resolved
    expect(ws.listenerCount("event")).toBeGreaterThan(0);

    // Simulate a tool_confirmation_required event from the worker
    ws.emit("event", {
      type: "tool_confirmation_required",
      callId: "call-123",
      toolName: "edit_file",
      input: { path: "/foo" },
    });

    expect(ownerSession.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_confirmation_required",
        callId: "call-123",
      }),
    );

    // Clean up: resolve the worker so the .then() handler can fire
    resolveWorker({ response: "done" });
  });

  // -------------------------------------------------------------------------
  // Artifact integration: completion notification includes artifacts
  // -------------------------------------------------------------------------

  describe("artifact integration", () => {
    let artifactDb: DatabaseSync;
    let artifactStore: ArtifactStore;

    afterEach(() => {
      bindArtifactStore(null as any);
      if (artifactStore) {
        artifactStore.destroy();
        artifactStore = undefined!;
      }
      if (artifactDb) {
        artifactDb.close();
        artifactDb = undefined!;
      }
    });

    function setupArtifactStore() {
      artifactDb = new DatabaseSync(":memory:");
      ensureArtifactSchema(artifactDb);
      artifactStore = ArtifactStore.create(artifactDb);
      bindArtifactStore(artifactStore);
    }

    it("includes artifact summary in completion notification", async () => {
      setupArtifactStore();

      const { app, workerSession: ws } = createDelegateMocks({ response: "analysis complete" });
      const tool = createKernelDelegateTool(app, OWNER_ID);

      // Pre-populate artifacts scoped to the worker's session ID
      artifactStore.store(
        {
          name: "auth-analysis",
          type: "analysis",
          content: "JWT with refresh tokens",
          summary: "Auth overview",
        },
        ws.id,
      );
      artifactStore.store(
        {
          name: "migration-plan",
          type: "plan",
          content: "Step 1: add column\nStep 2: backfill",
          summary: "DB migration strategy",
        },
        ws.id,
      );

      await run(tool, { task: "analyze auth", spec: "review auth system" });

      await vi.waitFor(() => {
        expect(app.receive).toHaveBeenCalled();
      });

      const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
      expect(receivedText).toContain("[Worker Complete]");
      expect(receivedText).toContain("Artifacts:");
      expect(receivedText).toContain("auth-analysis (analysis): Auth overview");
      expect(receivedText).toContain("migration-plan (plan): DB migration strategy");
    });

    it("uses content snippet when artifact has no summary", async () => {
      setupArtifactStore();

      const { app, workerSession: ws } = createDelegateMocks({ response: "done" });
      const tool = createKernelDelegateTool(app, OWNER_ID);

      artifactStore.store(
        { name: "raw-output", type: "code", content: "function authenticate() { return true; }" },
        ws.id,
      );

      await run(tool, { task: "write code", spec: "do it" });

      await vi.waitFor(() => {
        expect(app.receive).toHaveBeenCalled();
      });

      const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
      expect(receivedText).toContain("raw-output (code): function authenticate()");
    });

    it("omits artifact section when worker produced no artifacts", async () => {
      setupArtifactStore();

      const { app } = createDelegateMocks({ response: "nothing produced" });
      const tool = createKernelDelegateTool(app, OWNER_ID);

      await run(tool, { task: "simple task", spec: "do it" });

      await vi.waitFor(() => {
        expect(app.receive).toHaveBeenCalled();
      });

      const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
      expect(receivedText).toContain("[Worker Complete]");
      expect(receivedText).not.toContain("Artifacts:");
    });

    it("only includes artifacts from the worker session, not other sessions", async () => {
      setupArtifactStore();

      const { app, workerSession: ws } = createDelegateMocks({ response: "done" });
      const tool = createKernelDelegateTool(app, OWNER_ID);

      // Artifact from THIS worker
      artifactStore.store({ name: "mine", type: "code", content: "my code" }, ws.id);
      // Artifact from a DIFFERENT worker
      artifactStore.store(
        { name: "theirs", type: "code", content: "their code" },
        "other-worker-session",
      );
      // Artifact with no session
      artifactStore.store({ name: "orphan", type: "code", content: "no session" });

      await run(tool, { task: "scoped check", spec: "do it" });

      await vi.waitFor(() => {
        expect(app.receive).toHaveBeenCalled();
      });

      const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
      expect(receivedText).toContain("mine (code)");
      expect(receivedText).not.toContain("theirs");
      expect(receivedText).not.toContain("orphan");
    });

    it("works without artifact store bound (graceful degradation)", async () => {
      // Don't setup — getArtifactStore() returns null
      bindArtifactStore(null as any);

      const { app } = createDelegateMocks({ response: "done" });
      const tool = createKernelDelegateTool(app, OWNER_ID);

      await run(tool, { task: "no store", spec: "do it" });

      await vi.waitFor(() => {
        expect(app.receive).toHaveBeenCalled();
      });

      const receivedText = app.receive.mock.calls[0][1].payload.content[0].text;
      expect(receivedText).toContain("[Worker Complete]");
      expect(receivedText).not.toContain("Artifacts:");
    });
  });
});
