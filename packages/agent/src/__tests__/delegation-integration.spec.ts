import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ensureStorageSchema, TentickleSessionStore } from "@tentickle/storage";
import { extractText } from "@agentick/shared";

// ---------------------------------------------------------------------------
// Mock App + Session — minimal fakes that satisfy the delegation code
// ---------------------------------------------------------------------------

type SendResult = { response: string };
type MockSession = {
  id: string;
  send: ReturnType<typeof vi.fn>;
  mount: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
};

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

  return {
    id,
    // Return a ProcedurePromise-like: awaitable AND has .result synchronously
    send: vi.fn().mockImplementation(() => {
      const handle = { result: sendResult };
      return Object.assign(Promise.resolve(handle), { result: sendResult });
    }),
    mount: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockReturnValue({ timeline: [] }),
  };
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
    const customSupervisor: MockSession = {
      id: "cs-1",
      send: vi.fn().mockImplementation(() => {
        const handle = { result: customResult };
        return Object.assign(Promise.resolve(handle), { result: customResult });
      }),
      mount: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockReturnValue({ timeline: [] }),
    };
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
