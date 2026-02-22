import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { ensureStorageSchema, TentickleSessionStore } from "@tentickle/storage";
import { extractText } from "@agentick/shared";

// ---------------------------------------------------------------------------
// Mock App + Session — minimal fakes that satisfy the delegation code
// ---------------------------------------------------------------------------

type SendResult = { response: string };
type MockSession = EventEmitter & {
  id: string;
  send: ReturnType<typeof vi.fn>;
  mount: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  pushEvent: ReturnType<typeof vi.fn>;
  channel: (name: string) => { subscribe: (fn: any) => () => void; publish: (event: any) => void };
};

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

function createMockSession(
  id: string,
  opts?: { result?: SendResult | Error; resolveImmediately?: boolean },
): MockSession {
  const { result, resolveImmediately = false } = opts ?? {};

  const isError = result instanceof Error;
  let sendResult: Promise<SendResult>;
  if (resolveImmediately) {
    sendResult = isError ? Promise.reject(result) : Promise.resolve(result ?? { response: "done" });
  } else {
    // Deferred: resolve after a short delay so tests can inspect intermediate state
    sendResult = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (isError) reject(result);
        else resolve(result ?? { response: "done" });
      }, 5);
    });
  }
  // Suppress unhandled rejection for error cases — caught by .then(_, onRejected)
  sendResult.catch(() => {});

  const channels = new Map<string, ReturnType<typeof createMockChannel>>();

  const session = Object.assign(new EventEmitter(), {
    id,
    // Return a ProcedurePromise-like: awaitable AND has .result synchronously
    send: vi.fn().mockImplementation(() => {
      const handle = { result: sendResult };
      return Object.assign(Promise.resolve(handle), { result: sendResult });
    }),
    mount: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockReturnValue({ timeline: [] }),
    pushEvent: vi.fn().mockImplementation((event: any) => {
      session.emit("event", event);
    }),
    channel: (name: string) => {
      if (!channels.has(name)) channels.set(name, createMockChannel());
      return channels.get(name)!;
    },
  });

  return session as MockSession;
}

// Shorthand for sessions that resolve immediately (for tests that only care about the result)
function createImmediateSession(id: string, result?: SendResult | Error): MockSession {
  return createMockSession(id, { result, resolveImmediately: true });
}

function createMockApp(sessions: MockSession[] = []) {
  let sessionIndex = 0;
  const receivedMessages: Array<{ source: string; type: string; payload: unknown }> = [];
  const closedSessions: string[] = [];

  const sessionMap = new Map<string, MockSession>();
  for (const s of sessions) sessionMap.set(s.id, s);

  return {
    session: vi.fn(async (id?: string) => {
      if (id && sessionMap.has(id)) return sessionMap.get(id)!;
      // Auto-create for ID lookups (e.g. owner session for confirmation routing)
      if (id) {
        const auto = createMockSession(id, { resolveImmediately: true });
        sessionMap.set(id, auto);
        return auto;
      }
      if (sessionIndex < sessions.length) return sessions[sessionIndex++];
      throw new Error("No more mock sessions available");
    }),
    receive: vi.fn(async (msg: any) => {
      receivedMessages.push(msg);
    }),
    close: vi.fn(async (id: string) => {
      closedSessions.push(id);
    }),
    receivedMessages,
    closedSessions,
  };
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createDelegateTool } from "../tools/delegate.js";
import { createInspectJobTool } from "../tools/inspect-job.js";
import { createApproveJobTool, createCancelJobTool } from "../tools/job-control.js";
import {
  createSendToDelegateTool,
  createInspectDelegateTool,
  createCompleteDelegationTool,
  createEscalateTool,
} from "../tools/supervisor-tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshStore(): TentickleSessionStore {
  const db = new DatabaseSync(":memory:");
  ensureStorageSchema(db);
  return new TentickleSessionStore(db);
}

function text(result: Array<{ type: string; text: string }>): string {
  return result.map((b) => b.text).join("\n");
}

// createTool returns a ToolClass with `.run` Procedure.
// `.run(input).result` resolves to ContentBlock[].
async function run(tool: any, input: any): Promise<Array<{ type: string; text: string }>> {
  return tool.run(input).result;
}

// ---------------------------------------------------------------------------
// Dispatch delegation — end-to-end
// ---------------------------------------------------------------------------

describe("delegation integration: dispatch", () => {
  let store: TentickleSessionStore;
  let delegateSession: MockSession;
  let app: ReturnType<typeof createMockApp>;
  let tool: any;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    delegateSession = createMockSession("delegate-1");
    app = createMockApp([delegateSession]);
    tool = createDelegateTool(app as any, store, "owner-1");
  });

  it("creates delegate session with correct topology", async () => {
    const result = await run(tool, {
      description: "Fix the bug",
      spec: "Find and fix the null pointer in auth.ts",
    });

    expect(text(result)).toContain("Delegation started (dispatch)");
    expect(text(result)).toContain("delegate-1");

    const meta = store.getSessionMeta("delegate-1");
    expect(meta).not.toBeNull();
    expect(meta!.session_type).toBe("delegation");
    expect(meta!.parent_session_id).toBe("owner-1");
    expect(meta!.title).toBe("Fix the bug");
    expect(meta!.status).toBe("active");

    expect(store.getSnapshotValue("delegate-1", "objective")).toBe(
      "Find and fix the null pointer in auth.ts",
    );
  });

  it("sends spec to delegate session", async () => {
    await run(tool, {
      description: "Fix the bug",
      spec: "Find and fix the null pointer in auth.ts",
    });

    expect(delegateSession.send).toHaveBeenCalledOnce();
    const sendArg = delegateSession.send.mock.calls[0][0];
    expect(sendArg.messages[0].content[0].text).toBe("Find and fix the null pointer in auth.ts");
  });

  it("updates status to completed on success", async () => {
    await run(tool, { description: "Fix the bug", spec: "Find and fix the null pointer" });
    await new Promise((r) => setTimeout(r, 10));

    const meta = store.getSessionMeta("delegate-1");
    expect(meta!.status).toBe("completed");
    expect(store.getSnapshotValue("delegate-1", "result")).toBe("done");
  });

  it("notifies parent on completion via app.receive", async () => {
    await run(tool, { description: "Fix the bug", spec: "Find and fix the null pointer" });
    await new Promise((r) => setTimeout(r, 10));

    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.source).toBe("session:delegate-1");
    expect(msg.type).toBe("message");
    const t = extractText((msg.payload as any).content);
    expect(t).toContain("[Delegation Complete]");
    expect(t).toContain("Fix the bug");
  });

  it("updates status to failed on error", async () => {
    const failSession = createMockSession("fail-1", { result: new Error("Crashed hard") });
    const failApp = createMockApp([failSession]);
    const failTool = createDelegateTool(failApp as any, store, "owner-1");

    await run(failTool, { description: "Doomed task", spec: "This will fail" });
    await new Promise((r) => setTimeout(r, 10));

    const meta = store.getSessionMeta("fail-1");
    expect(meta!.status).toBe("failed");
    expect(store.getSnapshotValue("fail-1", "error")).toBe("Crashed hard");

    expect(failApp.receivedMessages).toHaveLength(1);
    const t = extractText((failApp.receivedMessages[0].payload as any).content);
    expect(t).toContain("[Delegation Failed]");
    expect(t).toContain("Crashed hard");
  });

  it("returns validation error when missing description", async () => {
    const result = await run(tool, { spec: "something" });
    expect(text(result)).toContain("description and spec are required");
  });

  it("returns validation error when missing spec", async () => {
    const result = await run(tool, { description: "something" });
    expect(text(result)).toContain("description and spec are required");
  });
});

// ---------------------------------------------------------------------------
// Supervised delegation — end-to-end
// ---------------------------------------------------------------------------

describe("delegation integration: supervised", () => {
  let store: TentickleSessionStore;
  let delegateSession: MockSession;
  let supervisorSession: MockSession;
  let app: ReturnType<typeof createMockApp>;
  let tool: any;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    delegateSession = createMockSession("sup-delegate-1");
    supervisorSession = createMockSession("supervisor-1");
    app = createMockApp([delegateSession, supervisorSession]);
    tool = createDelegateTool(app as any, store, "owner-1");
  });

  it("creates supervisor → delegate topology", async () => {
    const result = await run(tool, {
      description: "Refactor auth module",
      spec: "Extract auth logic into service class",
      supervised: true,
      supervisorCriteria: "Tests pass, no regressions",
    });

    expect(text(result)).toContain("Delegation started (supervised)");
    expect(text(result)).toContain("sup-delegate-1");
    expect(text(result)).toContain("supervisor-1");

    const supMeta = store.getSessionMeta("supervisor-1");
    expect(supMeta!.session_type).toBe("supervision");
    expect(supMeta!.parent_session_id).toBe("owner-1");
    expect(supMeta!.status).toBe("active");

    const delMeta = store.getSessionMeta("sup-delegate-1");
    expect(delMeta!.session_type).toBe("delegation");
    expect(delMeta!.parent_session_id).toBe("supervisor-1");

    expect(store.getSnapshotValue("supervisor-1", "criteria")).toBe("Tests pass, no regressions");
    expect(store.getSnapshotValue("sup-delegate-1", "objective")).toBe(
      "Extract auth logic into service class",
    );
  });

  it("mounts delegate before sending to supervisor", async () => {
    await run(tool, {
      description: "Task",
      spec: "Do the thing",
      supervised: true,
      supervisorCriteria: "It works",
    });

    expect(delegateSession.mount).toHaveBeenCalledOnce();
    expect(supervisorSession.send).toHaveBeenCalledOnce();
    const sendText = supervisorSession.send.mock.calls[0][0].messages[0].content[0].text;
    expect(sendText).toContain("Do the thing");
    expect(sendText).toContain("It works");
    expect(sendText).toContain("send_to_delegate");
  });

  it("marks both sessions completed on supervisor success", async () => {
    await run(tool, {
      description: "Task",
      spec: "Do it",
      supervised: true,
      supervisorCriteria: "Passes",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("supervisor-1")!.status).toBe("completed");
    expect(store.getSessionMeta("sup-delegate-1")!.status).toBe("completed");
  });

  it("marks both sessions failed on supervisor error", async () => {
    const failDelegate = createMockSession("fd-1");
    const failSupervisor = createMockSession("fs-1", { result: new Error("Supervisor crashed") });
    const failApp = createMockApp([failDelegate, failSupervisor]);
    const failTool = createDelegateTool(failApp as any, store, "owner-1");

    await run(failTool, {
      description: "Doomed",
      spec: "Fail",
      supervised: true,
      supervisorCriteria: "Never",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("fs-1")!.status).toBe("failed");
    expect(store.getSessionMeta("fd-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("fs-1", "error")).toBe("Supervisor crashed");
  });

  it("returns validation error when supervisorCriteria missing", async () => {
    const result = await run(tool, {
      description: "Task",
      spec: "Do it",
      supervised: true,
    });
    expect(text(result)).toContain("supervisorCriteria is required");
  });

  it("does not overwrite status if supervisor already completed via complete_delegation", async () => {
    // Use a longer delay so we can mark as completed before .then() fires
    const customResult = new Promise<SendResult>((resolve) => {
      setTimeout(() => resolve({ response: "All done via complete_delegation" }), 50);
    });
    const customSupervisor = createMockSession("cs-1");
    customSupervisor.send.mockImplementation(() => {
      const handle = { result: customResult };
      return Object.assign(Promise.resolve(handle), { result: customResult });
    });
    const customDelegate = createMockSession("cd-1");
    const customApp = createMockApp([customDelegate, customSupervisor]);
    const customTool = createDelegateTool(customApp as any, store, "owner-1");

    await run(customTool, {
      description: "Pre-completed",
      spec: "Spec",
      supervised: true,
      supervisorCriteria: "Criteria",
    });

    // Simulate complete_delegation tool marking supervisor done before .then() fires
    store.updateSessionMeta("cs-1", { status: "completed" });
    store.setSnapshotValue("cs-1", "result", "Completed by tool");

    // Wait for the deferred result to resolve and .then() to fire
    await new Promise((r) => setTimeout(r, 60));

    // The .then() should NOT overwrite because status was already 'completed'
    expect(store.getSnapshotValue("cs-1", "result")).toBe("Completed by tool");
    expect(store.getSessionMeta("cs-1")!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

describe("delegation integration: follow-up", () => {
  let store: TentickleSessionStore;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
  });

  it("sends follow-up to dispatch delegation", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
    });

    const targetSession = createMockSession("del-1");
    const app = createMockApp([targetSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    const result = await run(tool, { sessionId: "del-1", message: "How's progress?" });

    expect(text(result)).toContain("Follow-up sent to session del-1");
    expect(targetSession.send).toHaveBeenCalledOnce();
    const t = targetSession.send.mock.calls[0][0].messages[0].content[0].text;
    expect(t).toBe("How's progress?");
  });

  it("routes follow-up to supervisor when targeting supervised delegate", async () => {
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Supervised task",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Delegate",
    });

    const supervisorSession = createMockSession("sup-1");
    const app = createMockApp([supervisorSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    const result = await run(tool, { sessionId: "del-1", message: "Priority change!" });

    expect(text(result)).toContain("Follow-up sent to session sup-1");
    expect(supervisorSession.send).toHaveBeenCalledOnce();
  });

  it("sends directly to supervisor when targeting it", async () => {
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Supervised task",
    });

    const supervisorSession = createMockSession("sup-1");
    const app = createMockApp([supervisorSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    const result = await run(tool, { sessionId: "sup-1", message: "Check status" });
    expect(text(result)).toContain("Follow-up sent to session sup-1");
  });

  it("rejects follow-up to non-delegation session", async () => {
    store.initSession("chat-1", { sessionType: "chat", title: "Chat" });

    const app = createMockApp([]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    await expect(run(tool, { sessionId: "chat-1", message: "Hi" })).rejects.toThrow(
      "not a delegation",
    );
  });

  it("rejects follow-up to non-existent session", async () => {
    const app = createMockApp([]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    await expect(run(tool, { sessionId: "nope", message: "Hi" })).rejects.toThrow("not found");
  });

  it("returns validation error when message missing", async () => {
    const app = createMockApp([]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    const result = await run(tool, { sessionId: "anything" });
    expect(text(result)).toContain("message is required");
  });

  it("records error in KV when follow-up send fails", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
    });

    // Create a session whose send() result rejects
    const failResult = Promise.reject(new Error("session overloaded"));
    failResult.catch(() => {}); // suppress unhandled rejection
    const failSession: MockSession = {
      id: "del-1",
      send: vi.fn().mockImplementation(() => {
        return Object.assign(Promise.resolve({ result: failResult }), { result: failResult });
      }),
      mount: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockReturnValue({ timeline: [] }),
    };
    const app = createMockApp([failSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    // Should still return "Follow-up sent" (fire-and-forget)
    const result = await run(tool, { sessionId: "del-1", message: "Check in" });
    expect(text(result)).toContain("Follow-up sent");

    // Wait for the error handler to fire
    await new Promise((r) => setTimeout(r, 10));

    // Error should be recorded in KV
    expect(store.getSnapshotValue("del-1", "follow_up_error")).toBe("session overloaded");
  });
});

// ---------------------------------------------------------------------------
// Supervisor tools — send_to_delegate, inspect, complete, escalate
// ---------------------------------------------------------------------------

describe("supervisor tools integration", () => {
  let store: TentickleSessionStore;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Review auth refactor",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Auth refactor",
    });
  });

  it("send_to_delegate sends message and returns response", async () => {
    const delegateSession = createImmediateSession("del-1", {
      response: "Fixed the auth module. All tests pass.",
    });
    const app = createMockApp([delegateSession]);
    const tool = createSendToDelegateTool(app as any, "del-1");

    const result = await run(tool, { message: "Fix the auth module" });

    expect(text(result)).toBe("Fixed the auth module. All tests pass.");
    expect(delegateSession.send).toHaveBeenCalledOnce();
  });

  it("inspect_delegate shows timeline entries", async () => {
    const delegateSession: MockSession = {
      id: "del-1",
      send: vi.fn(),
      mount: vi.fn(),
      snapshot: vi.fn().mockReturnValue({
        timeline: [
          { message: { role: "user", content: [{ type: "text", text: "Fix auth" }] } },
          {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "I'll fix the auth module now." }],
            },
          },
        ],
      }),
    };
    const app = createMockApp([delegateSession]);
    const tool = createInspectDelegateTool(app as any, "del-1");

    const result = await run(tool, { lastN: 5 });

    expect(text(result)).toContain("[user] Fix auth");
    expect(text(result)).toContain("[assistant] I'll fix the auth module now.");
  });

  it("complete_delegation marks supervisor done and notifies parent", async () => {
    const app = createMockApp([]);
    const tool = createCompleteDelegationTool(app as any, store, "sup-1");

    const result = await run(tool, { summary: "Auth refactored, 100% test coverage" });

    expect(text(result)).toContain("Delegation marked complete");

    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(store.getSnapshotValue("sup-1", "result")).toBe("Auth refactored, 100% test coverage");

    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
    expect(app.closedSessions).toContain("del-1");

    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.source).toBe("session:sup-1");
    const t = extractText((msg.payload as any).content);
    expect(t).toContain("[Delegation Complete]");
    expect(t).toContain("Review auth refactor");
  });

  it("escalate sends reason to parent with session title", async () => {
    const app = createMockApp([]);
    const tool = createEscalateTool(app as any, store, "owner-1", "sup-1");

    const result = await run(tool, { reason: "Tests failing, need help" });

    expect(text(result)).toContain("Escalation sent");

    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.source).toBe("session:sup-1");
    const t = extractText((msg.payload as any).content);
    expect(t).toContain("[Escalation]");
    expect(t).toContain("Review auth refactor");
    expect(t).toContain("Tests failing, need help");
  });
});

// ---------------------------------------------------------------------------
// Job control tools — approve, cancel
// ---------------------------------------------------------------------------

describe("job control integration", () => {
  let store: TentickleSessionStore;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
  });

  it("approve_job closes dispatch delegation", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "completed",
    });

    const app = createMockApp([]);
    const tool = createApproveJobTool(app as any, store);
    const result = await run(tool, { sessionId: "del-1" });

    expect(text(result)).toContain("approved");
    expect(app.closedSessions).toContain("del-1");
  });

  it("approve_job closes supervised delegation and its children", async () => {
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Supervised",
      status: "completed",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Delegate",
      status: "completed",
    });

    const app = createMockApp([]);
    const tool = createApproveJobTool(app as any, store);
    await run(tool, { sessionId: "sup-1" });

    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-1");
  });

  it("approve_job marks active session as completed before closing", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "active",
    });

    const app = createMockApp([]);
    const tool = createApproveJobTool(app as any, store);
    await run(tool, { sessionId: "del-1" });

    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
    expect(store.getSnapshotValue("del-1", "result")).toBe("Approved by parent");
  });

  it("cancel_job marks delegation as failed and closes", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "active",
    });

    const app = createMockApp([]);
    const tool = createCancelJobTool(app as any, store);
    const result = await run(tool, { sessionId: "del-1", reason: "Wrong approach" });

    expect(text(result)).toContain("cancelled");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("del-1", "error")).toBe("Wrong approach");
    expect(app.closedSessions).toContain("del-1");
  });

  it("cancel_job cascades to children of supervised delegation", async () => {
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Supervised",
      status: "active",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Delegate",
      status: "active",
    });

    const app = createMockApp([]);
    const tool = createCancelJobTool(app as any, store);
    await run(tool, { sessionId: "sup-1" });

    expect(store.getSessionMeta("sup-1")!.status).toBe("failed");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-1");
  });

  it("approve_job handles non-existent session", async () => {
    const app = createMockApp([]);
    const tool = createApproveJobTool(app as any, store);
    const result = await run(tool, { sessionId: "nope" });
    expect(text(result)).toContain("not found");
  });

  it("cancel_job handles non-existent session", async () => {
    const app = createMockApp([]);
    const tool = createCancelJobTool(app as any, store);
    const result = await run(tool, { sessionId: "nope" });
    expect(text(result)).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Inspect job tool
// ---------------------------------------------------------------------------

describe("inspect_job integration", () => {
  let store: TentickleSessionStore;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Fix memory leak",
      status: "active",
    });
    store.setSnapshotValue("del-1", "objective", "Find and fix the memory leak in worker.ts");
  });

  it("shows session metadata and KV values", async () => {
    const session: MockSession = {
      id: "del-1",
      send: vi.fn(),
      mount: vi.fn(),
      snapshot: vi.fn().mockReturnValue({
        timeline: [{ message: { role: "user", content: [{ type: "text", text: "Fix it" }] } }],
      }),
    };
    const app = createMockApp([session]);
    const tool = createInspectJobTool(app as any, store);

    const result = await run(tool, { sessionId: "del-1" });
    const t = text(result);

    expect(t).toContain("Session: del-1");
    expect(t).toContain("Fix memory leak");
    expect(t).toContain("Status: active");
    expect(t).toContain("Type: delegation");
    expect(t).toContain("Parent: owner-1");
    expect(t).toContain("Find and fix the memory leak");
    expect(t).toContain("[user] Fix it");
  });

  it("handles non-existent session gracefully", async () => {
    const app = createMockApp([]);
    const tool = createInspectJobTool(app as any, store);

    const result = await run(tool, { sessionId: "nope" });
    expect(text(result)).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: race conditions, concurrent delegations, edge cases
// ---------------------------------------------------------------------------

describe("delegation integration: adversarial", () => {
  it("handles multiple concurrent dispatch delegations", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const sessions = Array.from({ length: 5 }, (_, i) => createMockSession(`batch-${i}`));
    const app = createMockApp(sessions);
    const tool = createDelegateTool(app as any, store, "owner-1");

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        run(tool, { description: `Task ${i}`, spec: `Do task ${i}` }),
      ),
    );

    for (const result of results) {
      expect(text(result)).toContain("Delegation started");
    }

    const active = store.getActiveDelegations("owner-1");
    expect(active.length).toBe(5);

    await new Promise((r) => setTimeout(r, 20));

    for (let i = 0; i < 5; i++) {
      expect(store.getSessionMeta(`batch-${i}`)!.status).toBe("completed");
    }
  });

  it("handles app.receive failure without crashing", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const session = createMockSession("del-1");
    const app = createMockApp([session]);
    app.receive.mockRejectedValue(new Error("inbox full"));

    const tool = createDelegateTool(app as any, store, "owner-1");

    await run(tool, { description: "Task", spec: "Do it" });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
    expect(store.getSnapshotValue("del-1", "notification_error")).toBe("inbox full");
  });

  it("handles app.close failure in approve_job without crashing", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "completed",
    });

    const app = createMockApp([]);
    app.close.mockRejectedValue(new Error("already closed"));

    const tool = createApproveJobTool(app as any, store);
    const result = await run(tool, { sessionId: "del-1" });
    expect(text(result)).toContain("approved");
  });

  it("complete_delegation is idempotent", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Task",
      status: "active",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Delegate",
      status: "active",
    });

    const app = createMockApp([]);
    const tool = createCompleteDelegationTool(app as any, store, "sup-1");

    await run(tool, { summary: "Done!" });
    await run(tool, { summary: "Done again!" });

    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(store.getSnapshotValue("sup-1", "result")).toBe("Done again!");
  });

  it("follow-up to completed delegation still works", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "completed",
    });

    const session = createMockSession("del-1");
    const app = createMockApp([session]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    const result = await run(tool, { sessionId: "del-1", message: "One more thing..." });

    expect(text(result)).toContain("Follow-up sent");
    expect(session.send).toHaveBeenCalledOnce();
  });

  it("inspect_job on session with unavailable timeline falls back gracefully", async () => {
    const store = freshStore();
    store.initSession("del-1", { sessionType: "delegation", title: "Gone" });

    const app = {
      session: vi.fn().mockRejectedValue(new Error("session gone")),
      receive: vi.fn(),
      close: vi.fn(),
    };

    const tool = createInspectJobTool(app as any, store);
    const result = await run(tool, { sessionId: "del-1" });
    const t = text(result);

    expect(t).toContain("Session: del-1");
    expect(t).toContain("(session not available)");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: supervisor review loop (the whole point of supervised mode)
// ---------------------------------------------------------------------------

describe("supervisor review loop", () => {
  let store: TentickleSessionStore;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Auth refactor",
      status: "active",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Delegate",
      status: "active",
    });
    store.setSnapshotValue("sup-1", "objective", "Refactor auth");
    store.setSnapshotValue("sup-1", "criteria", "Tests pass, types clean");
  });

  it("multi-turn: send → inspect → reject → send again → complete", async () => {
    let delegateCallCount = 0;
    const delegateSession: MockSession = {
      id: "del-1",
      send: vi.fn().mockImplementation(() => {
        delegateCallCount++;
        const response =
          delegateCallCount === 1
            ? { response: "Implemented but tests broken" }
            : { response: "Fixed. All 42 tests pass." };
        const result = Promise.resolve(response);
        return Object.assign(Promise.resolve({ result }), { result });
      }),
      mount: vi.fn(),
      snapshot: vi.fn().mockReturnValue({
        timeline: [
          { message: { role: "user", content: [{ type: "text", text: "Refactor auth" }] } },
          {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Done, but some tests fail" }],
            },
          },
        ],
      }),
    };
    const app = createMockApp([delegateSession]);

    const sendTool = createSendToDelegateTool(app as any, "del-1");
    const inspectTool = createInspectDelegateTool(app as any, "del-1");
    const completeTool = createCompleteDelegationTool(app as any, store, "sup-1");

    // Round 1: send spec, get back "tests broken"
    const r1 = await run(sendTool, { message: "Refactor the auth module" });
    expect(text(r1)).toContain("tests broken");

    // Inspect: verify we can see what happened
    const inspect1 = await run(inspectTool, { lastN: 5 });
    expect(text(inspect1)).toContain("[user] Refactor auth");
    expect(text(inspect1)).toContain("[assistant]");

    // Round 2: send feedback, get back "fixed"
    const r2 = await run(sendTool, { message: "Tests are failing. Fix them." });
    expect(text(r2)).toContain("42 tests pass");
    expect(delegateSession.send).toHaveBeenCalledTimes(2);

    // Complete
    const r3 = await run(completeTool, { summary: "Auth refactored. 42 tests pass." });
    expect(text(r3)).toContain("Delegation marked complete");

    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
    expect(app.receivedMessages).toHaveLength(1);
    expect(extractText((app.receivedMessages[0].payload as any).content)).toContain(
      "[Delegation Complete]",
    );
  });

  it("escalation mid-review terminates the loop", async () => {
    const delegateSession = createImmediateSession("del-1", {
      response: "I can't fix this — the types are fundamentally wrong",
    });
    const app = createMockApp([delegateSession]);

    const sendTool = createSendToDelegateTool(app as any, "del-1");
    const escalateTool = createEscalateTool(app as any, store, "owner-1", "sup-1");

    // Send to delegate, get back a hopeless response
    const r1 = await run(sendTool, { message: "Fix the types" });
    expect(text(r1)).toContain("fundamentally wrong");

    // Escalate instead of completing
    const r2 = await run(escalateTool, { reason: "Types need redesign, delegate can't fix" });
    expect(text(r2)).toContain("Escalation sent");

    // Owner should have received the escalation
    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.source).toBe("session:sup-1");
    expect(extractText((msg.payload as any).content)).toContain("[Escalation]");
    expect(extractText((msg.payload as any).content)).toContain("Types need redesign");

    // Supervisor session should still be active (escalation doesn't auto-close)
    expect(store.getSessionMeta("sup-1")!.status).toBe("active");
  });

  it("complete after escalation still works", async () => {
    const app = createMockApp([]);
    const escalateTool = createEscalateTool(app as any, store, "owner-1", "sup-1");
    const completeTool = createCompleteDelegationTool(app as any, store, "sup-1");

    // Escalate first
    await run(escalateTool, { reason: "Need help" });
    expect(app.receivedMessages).toHaveLength(1);

    // Then complete after owner provides guidance
    await run(completeTool, { summary: "Resolved after guidance" });
    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(app.receivedMessages).toHaveLength(2); // escalation + completion
  });
});

// ---------------------------------------------------------------------------
// Adversarial: race conditions and timing edges
// ---------------------------------------------------------------------------

describe("delegation races and timing", () => {
  it("follow-up during completion — follow-up targets the right session", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    // Create a session with a delayed result (simulates in-flight completion)
    let resolveResult: (v: SendResult) => void;
    const delayedResult = new Promise<SendResult>((r) => {
      resolveResult = r;
    });
    delayedResult.catch(() => {}); // suppress unhandled

    const delegateSession = createMockSession("del-1");
    delegateSession.send.mockImplementation(() => {
      const handle = { result: delayedResult };
      return Object.assign(Promise.resolve(handle), { result: delayedResult });
    });

    const followUpSession = createImmediateSession("del-1", { response: "Got the follow-up" });

    // First call: app.session() returns delegateSession (for dispatch)
    // Second call: app.session("del-1") returns followUpSession (for follow-up)
    const app = createMockApp([delegateSession, followUpSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    // Dispatch the delegation
    await run(tool, { description: "Task", spec: "Do the thing" });
    expect(store.getSessionMeta("del-1")!.status).toBe("active");

    // Send follow-up while delegation is still running
    const result = await run(tool, { sessionId: "del-1", message: "Priority change!" });
    expect(text(result)).toContain("Follow-up sent");

    // Now resolve the original delegation
    resolveResult!({ response: "Original work done" });
    await new Promise((r) => setTimeout(r, 10));

    // Status should be completed (from the original result handler)
    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
  });

  it("rapid double follow-up — both sends fire", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "active",
    });

    let sendCount = 0;
    const session = createMockSession("del-1");
    session.send.mockImplementation(() => {
      sendCount++;
      const result = Promise.resolve({ response: `response-${sendCount}` });
      return Object.assign(Promise.resolve({ result }), { result });
    });
    const app = createMockApp([session]);
    // app.session("del-1") must return the same session for both calls
    app.session.mockImplementation(async (id?: string) => {
      if (id === "del-1") return session;
      throw new Error("unexpected session request");
    });

    const tool = createDelegateTool(app as any, store, "owner-1");

    const [r1, r2] = await Promise.all([
      run(tool, { sessionId: "del-1", message: "First" }),
      run(tool, { sessionId: "del-1", message: "Second" }),
    ]);

    expect(text(r1)).toContain("Follow-up sent");
    expect(text(r2)).toContain("Follow-up sent");
    expect(session.send).toHaveBeenCalledTimes(2);
  });

  it("cancel during active delegation — status becomes failed", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    // Delegation that never resolves (simulates long-running work)
    const neverResult = new Promise<SendResult>(() => {});
    neverResult.catch(() => {}); // suppress
    const hangingSession = createMockSession("del-1");
    hangingSession.send.mockImplementation(() => {
      const handle = { result: neverResult };
      return Object.assign(Promise.resolve(handle), { result: neverResult });
    });

    const app = createMockApp([hangingSession]);
    const delegateTool = createDelegateTool(app as any, store, "owner-1");
    const cancelTool = createCancelJobTool(app as any, store);

    // Start delegation
    await run(delegateTool, { description: "Long task", spec: "This takes forever" });
    expect(store.getSessionMeta("del-1")!.status).toBe("active");

    // Cancel while still running
    const result = await run(cancelTool, { sessionId: "del-1", reason: "Taking too long" });
    expect(text(result)).toContain("cancelled");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("del-1", "error")).toBe("Taking too long");
    expect(app.closedSessions).toContain("del-1");
  });

  it("cancel supervised delegation during active review", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    // Never-resolving sessions for both delegate and supervisor
    const neverResult = new Promise<SendResult>(() => {});
    neverResult.catch(() => {});
    const makeStalledSession = (id: string) => {
      const s = createMockSession(id);
      s.send.mockImplementation(() => {
        const handle = { result: neverResult };
        return Object.assign(Promise.resolve(handle), { result: neverResult });
      });
      return s;
    };

    const app = createMockApp([makeStalledSession("del-1"), makeStalledSession("sup-1")]);
    const delegateTool = createDelegateTool(app as any, store, "owner-1");
    const cancelTool = createCancelJobTool(app as any, store);

    // Start supervised delegation
    await run(delegateTool, {
      description: "Task",
      spec: "Spec",
      supervised: true,
      supervisorCriteria: "Criteria",
    });
    expect(store.getSessionMeta("sup-1")!.status).toBe("active");
    expect(store.getSessionMeta("del-1")!.status).toBe("active");

    // Cancel the supervisor — should cascade to delegate
    await run(cancelTool, { sessionId: "sup-1", reason: "Abort" });

    expect(store.getSessionMeta("sup-1")!.status).toBe("failed");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-1");
  });

  it("notification error on dispatch failure is readable via inspect_job", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const session = createMockSession("del-1");
    const app = createMockApp([session]);
    app.receive.mockRejectedValue(new Error("parent session closed"));

    const delegateTool = createDelegateTool(app as any, store, "owner-1");

    await run(delegateTool, { description: "Task", spec: "Spec" });
    await new Promise((r) => setTimeout(r, 10));

    // notification_error should be stored
    expect(store.getSnapshotValue("del-1", "notification_error")).toBe("parent session closed");

    // And visible via inspect_job
    const inspectTool = createInspectJobTool(app as any, store);
    const result = await run(inspectTool, { sessionId: "del-1" });
    const t = text(result);
    expect(t).toContain("Notification Error: parent session closed");
  });

  it("notification error on supervised failure is readable via inspect_job", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const delegateSession = createMockSession("del-1");
    const supervisorSession = createMockSession("sup-1", {
      result: new Error("supervisor crashed"),
    });
    const app = createMockApp([delegateSession, supervisorSession]);
    app.receive.mockRejectedValue(new Error("inbox exploded"));

    const delegateTool = createDelegateTool(app as any, store, "owner-1");

    await run(delegateTool, {
      description: "Task",
      spec: "Spec",
      supervised: true,
      supervisorCriteria: "Criteria",
    });
    await new Promise((r) => setTimeout(r, 10));

    // Supervisor failed, notification to parent also failed
    expect(store.getSessionMeta("sup-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("sup-1", "notification_error")).toBe("inbox exploded");

    const inspectTool = createInspectJobTool(app as any, store);
    const result = await run(inspectTool, { sessionId: "sup-1" });
    expect(text(result)).toContain("Notification Error: inbox exploded");
    expect(text(result)).toContain("Error: supervisor crashed");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: deep topology (nested delegation)
// ---------------------------------------------------------------------------

describe("deep delegation topology", () => {
  it("owner → supervisor → delegate with full lifecycle", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const delegateSession = createMockSession("deep-del");
    const supervisorSession = createMockSession("deep-sup");
    const app = createMockApp([delegateSession, supervisorSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    await run(tool, {
      description: "Deep task",
      spec: "Nested work",
      supervised: true,
      supervisorCriteria: "Must pass",
    });

    // Verify three-level topology
    const ownerMeta = store.getSessionMeta("owner-1");
    const supMeta = store.getSessionMeta("deep-sup");
    const delMeta = store.getSessionMeta("deep-del");

    expect(ownerMeta!.session_type).toBe("chat");
    expect(supMeta!.session_type).toBe("supervision");
    expect(supMeta!.parent_session_id).toBe("owner-1");
    expect(delMeta!.session_type).toBe("delegation");
    expect(delMeta!.parent_session_id).toBe("deep-sup");

    // getChildSessions traversals work
    const ownerChildren = store.getChildSessions("owner-1");
    expect(ownerChildren).toHaveLength(1);
    expect(ownerChildren[0].id).toBe("deep-sup");

    const supChildren = store.getChildSessions("deep-sup");
    expect(supChildren).toHaveLength(1);
    expect(supChildren[0].id).toBe("deep-del");

    // getActiveDelegations only returns direct children
    const activeDels = store.getActiveDelegations("owner-1");
    expect(activeDels).toHaveLength(1);
    expect(activeDels[0].session_type).toBe("supervision");
  });

  it("multiple delegations from same owner — independent lifecycles", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    // d3 uses a never-resolving send so it stays active through the assertions
    const d3 = createMockSession("d3");
    const neverResolves = new Promise<never>(() => {});
    d3.send.mockImplementation(() =>
      Object.assign(Promise.resolve({ result: neverResolves }), { result: neverResolves }),
    );
    const sessions = [
      createImmediateSession("d1", { response: "Task 1 done" }),
      createImmediateSession("d2", { response: "Task 2 done" }),
      d3,
    ];
    const app = createMockApp(sessions);
    const tool = createDelegateTool(app as any, store, "owner-1");

    // Fire off 3 delegations
    await Promise.all([
      run(tool, { description: "Task 1", spec: "Fast" }),
      run(tool, { description: "Task 2", spec: "Also fast" }),
      run(tool, { description: "Task 3", spec: "Slow" }),
    ]);

    // Wait for the immediate ones to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("d1")!.status).toBe("completed");
    expect(store.getSessionMeta("d2")!.status).toBe("completed");
    expect(store.getSessionMeta("d3")!.status).toBe("active");

    // Only the slow one shows as active
    const active = store.getActiveDelegations("owner-1");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("d3");

    // All are children of owner
    const children = store.getChildSessions("owner-1");
    expect(children).toHaveLength(3);
  });

  it("approve_job on supervisor with multiple delegate children closes all", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Multi-child",
      status: "completed",
    });
    // Two delegates under one supervisor (unusual but should work)
    store.initSession("del-a", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Part A",
      status: "completed",
    });
    store.initSession("del-b", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Part B",
      status: "completed",
    });

    const app = createMockApp([]);
    const tool = createApproveJobTool(app as any, store);
    await run(tool, { sessionId: "sup-1" });

    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-a");
    expect(app.closedSessions).toContain("del-b");
  });
});

// ---------------------------------------------------------------------------
// inspect_job: error KV surfacing
// ---------------------------------------------------------------------------

describe("inspect_job error surfacing", () => {
  it("shows follow_up_error when present", async () => {
    const store = freshStore();
    store.initSession("del-1", {
      sessionType: "delegation",
      title: "Task",
      status: "active",
    });
    store.setSnapshotValue("del-1", "follow_up_error", "connection reset");

    const app = {
      session: vi.fn().mockResolvedValue({
        snapshot: () => ({ timeline: [] }),
      }),
      receive: vi.fn(),
      close: vi.fn(),
    };
    const tool = createInspectJobTool(app as any, store);
    const result = await run(tool, { sessionId: "del-1" });

    expect(text(result)).toContain("Follow-up Error: connection reset");
  });

  it("shows all error types simultaneously", async () => {
    const store = freshStore();
    store.initSession("del-1", {
      sessionType: "delegation",
      title: "Cursed task",
      status: "failed",
    });
    store.setSnapshotValue("del-1", "error", "handler threw");
    store.setSnapshotValue("del-1", "follow_up_error", "send failed");
    store.setSnapshotValue("del-1", "notification_error", "inbox full");
    store.setSnapshotValue("del-1", "result", "partial output");

    const app = {
      session: vi.fn().mockResolvedValue({
        snapshot: () => ({ timeline: [] }),
      }),
      receive: vi.fn(),
      close: vi.fn(),
    };
    const tool = createInspectJobTool(app as any, store);
    const result = await run(tool, { sessionId: "del-1" });
    const t = text(result);

    expect(t).toContain("Error: handler threw");
    expect(t).toContain("Follow-up Error: send failed");
    expect(t).toContain("Notification Error: inbox full");
    expect(t).toContain("Result: partial output");
    expect(t).toContain("Status: failed");
  });
});

// ---------------------------------------------------------------------------
// Session resolver — routes "session:*" messages to parent
// ---------------------------------------------------------------------------

describe("session resolver logic", () => {
  it("resolves session:childId to parent_session_id", () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
    });

    // Simulate the resolver logic from app.ts
    const resolve = (source: string): string | null => {
      if (source.startsWith("session:")) {
        const childId = source.slice(8);
        const meta = store.getSessionMeta(childId);
        if (meta?.parent_session_id) return meta.parent_session_id;
      }
      return null;
    };

    expect(resolve("session:del-1")).toBe("owner-1");
  });

  it("resolves supervised delegate through supervisor to owner", () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Supervised",
    });
    store.initSession("del-1", {
      parentSessionId: "sup-1",
      sessionType: "delegation",
      title: "Delegate",
    });

    const resolve = (source: string): string | null => {
      if (source.startsWith("session:")) {
        const childId = source.slice(8);
        const meta = store.getSessionMeta(childId);
        if (meta?.parent_session_id) return meta.parent_session_id;
      }
      return null;
    };

    // Supervisor notification routes to owner
    expect(resolve("session:sup-1")).toBe("owner-1");
    // Delegate notification routes to supervisor
    expect(resolve("session:del-1")).toBe("sup-1");
  });

  it("returns null for non-session sources", () => {
    const store = freshStore();

    const resolve = (source: string): string | null => {
      if (source.startsWith("session:")) {
        const childId = source.slice(8);
        const meta = store.getSessionMeta(childId);
        if (meta?.parent_session_id) return meta.parent_session_id;
      }
      return null;
    };

    expect(resolve("user:bob")).toBeNull();
    expect(resolve("webhook:123")).toBeNull();
  });

  it("returns null for session without parent", () => {
    const store = freshStore();
    store.initSession("root", { sessionType: "chat", title: "Root" });

    const resolve = (source: string): string | null => {
      if (source.startsWith("session:")) {
        const childId = source.slice(8);
        const meta = store.getSessionMeta(childId);
        if (meta?.parent_session_id) return meta.parent_session_id;
      }
      return null;
    };

    expect(resolve("session:root")).toBeNull();
  });

  it("returns null for nonexistent session", () => {
    const store = freshStore();

    const resolve = (source: string): string | null => {
      if (source.startsWith("session:")) {
        const childId = source.slice(8);
        const meta = store.getSessionMeta(childId);
        if (meta?.parent_session_id) return meta.parent_session_id;
      }
      return null;
    };

    expect(resolve("session:ghost")).toBeNull();
  });
});
