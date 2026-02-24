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
    sendResult = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (isError) reject(result);
        else resolve(result ?? { response: "done" });
      }, 5);
    });
  }
  sendResult.catch(() => {});

  const channels = new Map<string, ReturnType<typeof createMockChannel>>();

  const session = Object.assign(new EventEmitter(), {
    id,
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

function createImmediateSession(id: string, result?: SendResult | Error): MockSession {
  return createMockSession(id, { result, resolveImmediately: true });
}

function createMockApp(sessions: MockSession[] = []) {
  let sessionIndex = 0;
  const receivedMessages: Array<{
    targetSessionId: string;
    source: string;
    type: string;
    payload: unknown;
  }> = [];
  const closedSessions: string[] = [];

  const sessionMap = new Map<string, MockSession>();
  for (const s of sessions) sessionMap.set(s.id, s);

  return {
    session: vi.fn(async (idOrOptions?: string | { parentSessionId?: string }) => {
      if (typeof idOrOptions === "object" && idOrOptions !== null) {
        if (sessionIndex < sessions.length) return sessions[sessionIndex++];
        throw new Error("No more mock sessions available");
      }
      const id = idOrOptions;
      if (id && sessionMap.has(id)) return sessionMap.get(id)!;
      if (id) {
        const auto = createMockSession(id, { resolveImmediately: true });
        sessionMap.set(id, auto);
        return auto;
      }
      if (sessionIndex < sessions.length) return sessions[sessionIndex++];
      throw new Error("No more mock sessions available");
    }),
    receive: vi.fn(async (sessionIdOrMsg: string | any, msg?: any) => {
      if (typeof sessionIdOrMsg === "string" && msg) {
        receivedMessages.push({ targetSessionId: sessionIdOrMsg, ...msg });
        return;
      }
      receivedMessages.push({ targetSessionId: "unknown", ...sessionIdOrMsg });
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

import {
  createDelegateTool,
  createSendSessionTool,
  createNotifyParentTool,
  createSessionsTool,
} from "../tools/delegate.js";

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

async function run(tool: any, input: any): Promise<Array<{ type: string; text: string }>> {
  return tool.run(input).result;
}

// ===========================================================================
// delegate tool — dispatch mode
// ===========================================================================

describe("delegate: dispatch", () => {
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

  it("notifies parent on completion via direct delivery", async () => {
    await run(tool, { description: "Fix the bug", spec: "Find and fix the null pointer" });
    await new Promise((r) => setTimeout(r, 10));

    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.targetSessionId).toBe("owner-1");
    expect(msg.source).toBe("delegation");
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
    expect(failApp.receivedMessages[0].targetSessionId).toBe("owner-1");
    const t = extractText((failApp.receivedMessages[0].payload as any).content);
    expect(t).toContain("[Delegation Failed]");
    expect(t).toContain("Crashed hard");
  });

  it("skips notification if delegate already handled (notify_parent guard)", async () => {
    // Use a delayed result so we can mark as completed before .then() fires
    const customResult = new Promise<SendResult>((resolve) => {
      setTimeout(() => resolve({ response: "Original completion" }), 50);
    });
    const customSession = createMockSession("guard-1");
    customSession.send.mockImplementation(() => {
      const handle = { result: customResult };
      return Object.assign(Promise.resolve(handle), { result: customResult });
    });
    const customApp = createMockApp([customSession]);
    const customTool = createDelegateTool(customApp as any, store, "owner-1");

    await run(customTool, { description: "Guarded", spec: "Test guard" });

    // Simulate delegate calling notify_parent before dispatch handler fires
    store.updateSessionMeta("guard-1", { status: "completed" });
    store.setSnapshotValue("guard-1", "result", "Set by notify_parent");

    await new Promise((r) => setTimeout(r, 60));

    // Dispatch handler should have skipped because status was no longer "active"
    expect(store.getSnapshotValue("guard-1", "result")).toBe("Set by notify_parent");
    expect(customApp.receivedMessages).toHaveLength(0);
  });
});

// ===========================================================================
// delegate tool — supervised mode
// ===========================================================================

describe("delegate: supervised", () => {
  let store: TentickleSessionStore;
  let delegateSession: MockSession;
  let supervisorSession: MockSession;
  let app: ReturnType<typeof createMockApp>;
  let tool: any;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    supervisorSession = createMockSession("supervisor-1");
    delegateSession = createMockSession("sup-delegate-1");
    app = createMockApp([supervisorSession, delegateSession]);
    tool = createDelegateTool(app as any, store, "owner-1");
  });

  it("creates supervisor → delegate topology", async () => {
    const result = await run(tool, {
      description: "Refactor auth module",
      spec: "Extract auth logic into service class",
      supervised: true,
      criteria: "Tests pass, no regressions",
    });

    expect(text(result)).toContain("Supervised delegation started");
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
      criteria: "It works",
    });

    expect(delegateSession.mount).toHaveBeenCalledOnce();
    expect(supervisorSession.send).toHaveBeenCalledOnce();
    const sendText = supervisorSession.send.mock.calls[0][0].messages[0].content[0].text;
    expect(sendText).toContain("Do the thing");
    expect(sendText).toContain("It works");
    expect(sendText).toContain("send_session");
    expect(sendText).toContain("notify_parent");
  });

  it("marks both sessions completed on supervisor success", async () => {
    await run(tool, {
      description: "Task",
      spec: "Do it",
      supervised: true,
      criteria: "Passes",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("supervisor-1")!.status).toBe("completed");
    expect(store.getSessionMeta("sup-delegate-1")!.status).toBe("completed");
  });

  it("marks both sessions failed on supervisor error", async () => {
    const failSupervisor = createMockSession("fs-1", { result: new Error("Supervisor crashed") });
    const failDelegate = createMockSession("fd-1");
    const failApp = createMockApp([failSupervisor, failDelegate]);
    const failTool = createDelegateTool(failApp as any, store, "owner-1");

    await run(failTool, {
      description: "Doomed",
      spec: "Fail",
      supervised: true,
      criteria: "Never",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("fs-1")!.status).toBe("failed");
    expect(store.getSessionMeta("fd-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("fs-1", "error")).toBe("Supervisor crashed");
  });

  it("returns validation error when criteria missing for supervised", async () => {
    const result = await run(tool, {
      description: "Task",
      spec: "Do it",
      supervised: true,
    });
    expect(text(result)).toContain("criteria required");
  });

  it("does not overwrite status if supervisor already completed via notify_parent", async () => {
    const customResult = new Promise<SendResult>((resolve) => {
      setTimeout(() => resolve({ response: "All done" }), 50);
    });
    const customSupervisor = createMockSession("cs-1");
    customSupervisor.send.mockImplementation(() => {
      const handle = { result: customResult };
      return Object.assign(Promise.resolve(handle), { result: customResult });
    });
    const customDelegate = createMockSession("cd-1");
    const customApp = createMockApp([customSupervisor, customDelegate]);
    const customTool = createDelegateTool(customApp as any, store, "owner-1");

    await run(customTool, {
      description: "Pre-completed",
      spec: "Spec",
      supervised: true,
      criteria: "Criteria",
    });

    // Simulate notify_parent({ type: "completion" }) marking supervisor done
    store.updateSessionMeta("cs-1", { status: "completed" });
    store.setSnapshotValue("cs-1", "result", "Completed by tool");

    await new Promise((r) => setTimeout(r, 60));

    expect(store.getSnapshotValue("cs-1", "result")).toBe("Completed by tool");
    expect(store.getSessionMeta("cs-1")!.status).toBe("completed");

    // Critical: owner must NOT receive a duplicate notification from the .then() handler
    expect(customApp.receivedMessages).toHaveLength(0);
  });
});

// ===========================================================================
// send_session tool
// ===========================================================================

describe("send_session", () => {
  it("sends message and returns response", async () => {
    const delegateSession = createImmediateSession("del-1", {
      response: "Fixed the auth module. All tests pass.",
    });
    const app = createMockApp([delegateSession]);
    const tool = createSendSessionTool(app as any);

    const result = await run(tool, { sessionId: "del-1", message: "Fix the auth module" });

    expect(text(result)).toBe("Fixed the auth module. All tests pass.");
    expect(delegateSession.send).toHaveBeenCalledOnce();
  });

  it("sends to any session by ID (follow-up replacement)", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
    });

    const session = createImmediateSession("del-1", { response: "Got it" });
    const app = createMockApp([session]);
    const tool = createSendSessionTool(app as any);

    const result = await run(tool, { sessionId: "del-1", message: "Priority change!" });
    expect(text(result)).toBe("Got it");
  });

  it("propagates error when session send fails", async () => {
    const failResult = Promise.reject(new Error("session overloaded"));
    failResult.catch(() => {});
    const failSession = {
      id: "del-1",
      send: vi.fn().mockImplementation(() => {
        return Object.assign(Promise.resolve({ result: failResult }), { result: failResult });
      }),
    } as any;
    const app = createMockApp([failSession]);
    const tool = createSendSessionTool(app as any);

    await expect(run(tool, { sessionId: "del-1", message: "Hello" })).rejects.toThrow(
      "session overloaded",
    );
  });
});

// ===========================================================================
// notify_parent tool
// ===========================================================================

describe("notify_parent", () => {
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

  it("completion marks session done and notifies parent", async () => {
    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "sup-1");

    const result = await run(tool, {
      type: "completion",
      message: "Auth refactored, 100% test coverage",
    });

    expect(text(result)).toContain("Marked complete");

    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(store.getSnapshotValue("sup-1", "result")).toBe("Auth refactored, 100% test coverage");

    // Delegate child should be closed
    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
    expect(app.closedSessions).toContain("del-1");

    // Parent notification
    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.targetSessionId).toBe("owner-1");
    expect(msg.source).toBe("delegation");
    const t = extractText((msg.payload as any).content);
    expect(t).toContain("[Delegation Complete]");
    expect(t).toContain("Review auth refactor");
  });

  it("escalation notifies parent without closing session", async () => {
    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "sup-1");

    const result = await run(tool, {
      type: "escalation",
      message: "Tests failing, need help",
    });

    expect(text(result)).toContain("Escalation sent");

    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.targetSessionId).toBe("owner-1");
    expect(msg.source).toBe("escalation");
    const t = extractText((msg.payload as any).content);
    expect(t).toContain("[Escalation]");
    expect(t).toContain("Review auth refactor");
    expect(t).toContain("Tests failing, need help");

    // Session stays active
    expect(store.getSessionMeta("sup-1")!.status).toBe("active");
  });

  it("errors when no parent session", async () => {
    store.initSession("orphan-1", { sessionType: "delegation", title: "Orphan" });
    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "orphan-1");

    const result = await run(tool, { type: "completion", message: "Done" });
    expect(text(result)).toContain("no parent session");
  });

  it("completion after escalation still works", async () => {
    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "sup-1");

    await run(tool, { type: "escalation", message: "Need help" });
    expect(app.receivedMessages).toHaveLength(1);

    await run(tool, { type: "completion", message: "Resolved after guidance" });
    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(app.receivedMessages).toHaveLength(2);
  });

  it("completion is idempotent", async () => {
    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "sup-1");

    await run(tool, { type: "completion", message: "Done!" });
    await run(tool, { type: "completion", message: "Done again!" });

    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(store.getSnapshotValue("sup-1", "result")).toBe("Done again!");
  });

  it("delegate can also use notify_parent for escalation", async () => {
    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "del-1");

    const result = await run(tool, {
      type: "escalation",
      message: "Stuck on types",
    });

    expect(text(result)).toContain("Escalation sent");
    expect(app.receivedMessages).toHaveLength(1);
    expect(app.receivedMessages[0].targetSessionId).toBe("sup-1");
    expect(app.receivedMessages[0].source).toBe("escalation");
  });
});

// ===========================================================================
// sessions tool — list
// ===========================================================================

describe("sessions: list", () => {
  it("lists active delegations", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Fix bug",
      status: "active",
    });
    store.initSession("del-2", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Add feature",
      status: "active",
    });

    const app = createMockApp([]);
    const tool = createSessionsTool(app as any, store, "owner-1");

    const result = await run(tool, { action: "list" });
    const t = text(result);
    expect(t).toContain("Fix bug");
    expect(t).toContain("Add feature");
  });

  it("returns empty when no active delegations", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const app = createMockApp([]);
    const tool = createSessionsTool(app as any, store, "owner-1");

    const result = await run(tool, { action: "list" });
    expect(text(result)).toContain("No active delegations");
  });
});

// ===========================================================================
// sessions tool — inspect
// ===========================================================================

describe("sessions: inspect", () => {
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

  it("shows session metadata and timeline", async () => {
    const session = {
      id: "del-1",
      send: vi.fn(),
      mount: vi.fn(),
      snapshot: vi.fn().mockReturnValue({
        timeline: [{ message: { role: "user", content: [{ type: "text", text: "Fix it" }] } }],
      }),
    } as any;
    const app = createMockApp([session]);
    const tool = createSessionsTool(app as any, store, "owner-1");

    const result = await run(tool, { action: "inspect", sessionId: "del-1" });
    const t = text(result);

    expect(t).toContain("Session: del-1");
    expect(t).toContain("Fix memory leak");
    expect(t).toContain("Status: active");
    expect(t).toContain("Type: delegation");
    expect(t).toContain("Parent: owner-1");
    expect(t).toContain("Find and fix the memory leak");
    expect(t).toContain("[user] Fix it");
  });

  it("handles non-existent session", async () => {
    const app = createMockApp([]);
    const tool = createSessionsTool(app as any, store, "owner-1");

    const result = await run(tool, { action: "inspect", sessionId: "nope" });
    expect(text(result)).toContain("not found");
  });

  it("handles unavailable timeline gracefully", async () => {
    const app = {
      session: vi.fn().mockRejectedValue(new Error("session gone")),
      receive: vi.fn(),
      close: vi.fn(),
    };
    const tool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(tool, { action: "inspect", sessionId: "del-1" });
    const t = text(result);

    expect(t).toContain("Session: del-1");
    expect(t).toContain("(session not available)");
  });

  it("shows notification error when present", async () => {
    store.setSnapshotValue("del-1", "notification_error", "inbox full");
    store.setSnapshotValue("del-1", "error", "handler threw");
    store.setSnapshotValue("del-1", "result", "partial output");
    store.updateSessionMeta("del-1", { status: "failed" });

    const app = {
      session: vi.fn().mockResolvedValue({ snapshot: () => ({ timeline: [] }) }),
      receive: vi.fn(),
      close: vi.fn(),
    };
    const tool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(tool, { action: "inspect", sessionId: "del-1" });
    const t = text(result);

    expect(t).toContain("Error: handler threw");
    expect(t).toContain("Notification Error: inbox full");
    expect(t).toContain("Result: partial output");
    expect(t).toContain("Status: failed");
  });

  it("requires sessionId", async () => {
    const app = createMockApp([]);
    const tool = createSessionsTool(app as any, store, "owner-1");

    const result = await run(tool, { action: "inspect" });
    expect(text(result)).toContain("sessionId required");
  });
});

// ===========================================================================
// sessions tool — close
// ===========================================================================

describe("sessions: close", () => {
  let store: TentickleSessionStore;

  beforeEach(() => {
    store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
  });

  it("closes dispatch delegation (approve)", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "completed",
    });

    const app = createMockApp([]);
    const tool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(tool, { action: "close", sessionId: "del-1" });

    expect(text(result)).toContain("completed");
    expect(app.closedSessions).toContain("del-1");
  });

  it("closes supervised delegation and children", async () => {
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
    const tool = createSessionsTool(app as any, store, "owner-1");
    await run(tool, { action: "close", sessionId: "sup-1" });

    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-1");
  });

  it("cancel marks as failed with reason", async () => {
    store.initSession("del-1", {
      parentSessionId: "owner-1",
      sessionType: "delegation",
      title: "Task",
      status: "active",
    });

    const app = createMockApp([]);
    const tool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(tool, {
      action: "close",
      sessionId: "del-1",
      status: "cancelled",
      reason: "Wrong approach",
    });

    expect(text(result)).toContain("cancelled");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("del-1", "error")).toBe("Wrong approach");
    expect(app.closedSessions).toContain("del-1");
  });

  it("cancel cascades to children of supervised delegation", async () => {
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
    const tool = createSessionsTool(app as any, store, "owner-1");
    await run(tool, { action: "close", sessionId: "sup-1", status: "cancelled" });

    expect(store.getSessionMeta("sup-1")!.status).toBe("failed");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-1");
  });

  it("close with multiple delegate children closes all", async () => {
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Multi-child",
      status: "completed",
    });
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
    const tool = createSessionsTool(app as any, store, "owner-1");
    await run(tool, { action: "close", sessionId: "sup-1" });

    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-a");
    expect(app.closedSessions).toContain("del-b");
  });
});

// ===========================================================================
// Adversarial: concurrency, races, error paths
// ===========================================================================

describe("adversarial: concurrency and errors", () => {
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

  it("handles app.close failure in sessions close without crashing", async () => {
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

    const tool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(tool, { action: "close", sessionId: "del-1" });
    expect(text(result)).toContain("completed");
  });

  it("cancel during active delegation — status becomes failed", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const neverResult = new Promise<SendResult>(() => {});
    neverResult.catch(() => {});
    const hangingSession = createMockSession("del-1");
    hangingSession.send.mockImplementation(() => {
      const handle = { result: neverResult };
      return Object.assign(Promise.resolve(handle), { result: neverResult });
    });

    const app = createMockApp([hangingSession]);
    const delegateTool = createDelegateTool(app as any, store, "owner-1");
    const sessionsTool = createSessionsTool(app as any, store, "owner-1");

    await run(delegateTool, { description: "Long task", spec: "This takes forever" });
    expect(store.getSessionMeta("del-1")!.status).toBe("active");

    const result = await run(sessionsTool, {
      action: "close",
      sessionId: "del-1",
      status: "cancelled",
      reason: "Taking too long",
    });
    expect(text(result)).toContain("cancelled");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("del-1", "error")).toBe("Taking too long");
    expect(app.closedSessions).toContain("del-1");
  });

  it("cancel supervised delegation during active review", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

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

    const app = createMockApp([makeStalledSession("sup-1"), makeStalledSession("del-1")]);
    const delegateTool = createDelegateTool(app as any, store, "owner-1");
    const sessionsTool = createSessionsTool(app as any, store, "owner-1");

    await run(delegateTool, {
      description: "Task",
      spec: "Spec",
      supervised: true,
      criteria: "Criteria",
    });
    expect(store.getSessionMeta("sup-1")!.status).toBe("active");
    expect(store.getSessionMeta("del-1")!.status).toBe("active");

    await run(sessionsTool, { action: "close", sessionId: "sup-1", status: "cancelled" });

    expect(store.getSessionMeta("sup-1")!.status).toBe("failed");
    expect(store.getSessionMeta("del-1")!.status).toBe("failed");
    expect(app.closedSessions).toContain("sup-1");
    expect(app.closedSessions).toContain("del-1");
  });

  it("notification error on dispatch failure is visible via sessions inspect", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const session = createMockSession("del-1");
    const app = createMockApp([session]);
    app.receive.mockRejectedValue(new Error("parent session closed"));

    const delegateTool = createDelegateTool(app as any, store, "owner-1");

    await run(delegateTool, { description: "Task", spec: "Spec" });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSnapshotValue("del-1", "notification_error")).toBe("parent session closed");

    const sessionsTool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(sessionsTool, { action: "inspect", sessionId: "del-1" });
    expect(text(result)).toContain("Notification Error: parent session closed");
  });

  it("notification error on supervised failure is visible via sessions inspect", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const supervisorSession = createMockSession("sup-1", {
      result: new Error("supervisor crashed"),
    });
    const delegateSession = createMockSession("del-1");
    const app = createMockApp([supervisorSession, delegateSession]);
    app.receive.mockRejectedValue(new Error("inbox exploded"));

    const delegateTool = createDelegateTool(app as any, store, "owner-1");

    await run(delegateTool, {
      description: "Task",
      spec: "Spec",
      supervised: true,
      criteria: "Criteria",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("sup-1")!.status).toBe("failed");
    expect(store.getSnapshotValue("sup-1", "notification_error")).toBe("inbox exploded");

    const sessionsTool = createSessionsTool(app as any, store, "owner-1");
    const result = await run(sessionsTool, { action: "inspect", sessionId: "sup-1" });
    expect(text(result)).toContain("Notification Error: inbox exploded");
    expect(text(result)).toContain("Error: supervisor crashed");
  });
});

// ===========================================================================
// Supervisor review loop — the whole point of supervised mode
// ===========================================================================

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
    const delegateSession = {
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
    } as any;
    const app = createMockApp([delegateSession]);

    const sendTool = createSendSessionTool(app as any);
    const sessionsTool = createSessionsTool(app as any, store, "sup-1");
    const notifyTool = createNotifyParentTool(app as any, store, "sup-1");

    // Round 1: send spec, get back "tests broken"
    const r1 = await run(sendTool, { sessionId: "del-1", message: "Refactor the auth module" });
    expect(text(r1)).toContain("tests broken");

    // Inspect: verify we can see what happened
    const inspect1 = await run(sessionsTool, { action: "inspect", sessionId: "del-1" });
    expect(text(inspect1)).toContain("[user] Refactor auth");
    expect(text(inspect1)).toContain("[assistant]");

    // Round 2: send feedback, get back "fixed"
    const r2 = await run(sendTool, { sessionId: "del-1", message: "Tests are failing. Fix them." });
    expect(text(r2)).toContain("42 tests pass");
    expect(delegateSession.send).toHaveBeenCalledTimes(2);

    // Complete
    const r3 = await run(notifyTool, {
      type: "completion",
      message: "Auth refactored. 42 tests pass.",
    });
    expect(text(r3)).toContain("Marked complete");

    expect(store.getSessionMeta("sup-1")!.status).toBe("completed");
    expect(store.getSessionMeta("del-1")!.status).toBe("completed");
    expect(app.receivedMessages).toHaveLength(1);
    expect(app.receivedMessages[0].targetSessionId).toBe("owner-1");
    expect(extractText((app.receivedMessages[0].payload as any).content)).toContain(
      "[Delegation Complete]",
    );
  });

  it("escalation mid-review terminates the loop", async () => {
    const delegateSession = createImmediateSession("del-1", {
      response: "I can't fix this — the types are fundamentally wrong",
    });
    const app = createMockApp([delegateSession]);

    const sendTool = createSendSessionTool(app as any);
    const notifyTool = createNotifyParentTool(app as any, store, "sup-1");

    // Send to delegate, get back a hopeless response
    const r1 = await run(sendTool, { sessionId: "del-1", message: "Fix the types" });
    expect(text(r1)).toContain("fundamentally wrong");

    // Escalate instead of completing
    const r2 = await run(notifyTool, {
      type: "escalation",
      message: "Types need redesign, delegate can't fix",
    });
    expect(text(r2)).toContain("Escalation sent");

    expect(app.receivedMessages).toHaveLength(1);
    const msg = app.receivedMessages[0];
    expect(msg.targetSessionId).toBe("owner-1");
    expect(msg.source).toBe("escalation");
    expect(extractText((msg.payload as any).content)).toContain("[Escalation]");
    expect(extractText((msg.payload as any).content)).toContain("Types need redesign");

    // Session stays active
    expect(store.getSessionMeta("sup-1")!.status).toBe("active");
  });
});

// ===========================================================================
// Deep delegation topology
// ===========================================================================

describe("deep delegation topology", () => {
  it("owner → supervisor → delegate with full lifecycle", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const supervisorSession = createMockSession("deep-sup");
    const delegateSession = createMockSession("deep-del");
    const app = createMockApp([supervisorSession, delegateSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    await run(tool, {
      description: "Deep task",
      spec: "Nested work",
      supervised: true,
      criteria: "Must pass",
    });

    const ownerMeta = store.getSessionMeta("owner-1");
    const supMeta = store.getSessionMeta("deep-sup");
    const delMeta = store.getSessionMeta("deep-del");

    expect(ownerMeta!.session_type).toBe("chat");
    expect(supMeta!.session_type).toBe("supervision");
    expect(supMeta!.parent_session_id).toBe("owner-1");
    expect(delMeta!.session_type).toBe("delegation");
    expect(delMeta!.parent_session_id).toBe("deep-sup");

    const ownerChildren = store.getChildSessions("owner-1");
    expect(ownerChildren).toHaveLength(1);
    expect(ownerChildren[0].id).toBe("deep-sup");

    const supChildren = store.getChildSessions("deep-sup");
    expect(supChildren).toHaveLength(1);
    expect(supChildren[0].id).toBe("deep-del");

    const activeDels = store.getActiveDelegations("owner-1");
    expect(activeDels).toHaveLength(1);
    expect(activeDels[0].session_type).toBe("supervision");
  });

  it("multiple delegations from same owner — independent lifecycles", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

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

    await Promise.all([
      run(tool, { description: "Task 1", spec: "Fast" }),
      run(tool, { description: "Task 2", spec: "Also fast" }),
      run(tool, { description: "Task 3", spec: "Slow" }),
    ]);

    await new Promise((r) => setTimeout(r, 10));

    expect(store.getSessionMeta("d1")!.status).toBe("completed");
    expect(store.getSessionMeta("d2")!.status).toBe("completed");
    expect(store.getSessionMeta("d3")!.status).toBe("active");

    const active = store.getActiveDelegations("owner-1");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("d3");

    const children = store.getChildSessions("owner-1");
    expect(children).toHaveLength(3);
  });
});

// ===========================================================================
// Direct delivery pattern
// ===========================================================================

describe("direct delivery", () => {
  it("dispatch notification targets parent directly", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const delegateSession = createMockSession("del-1");
    const app = createMockApp([delegateSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    await run(tool, { description: "Task", spec: "Spec" });
    await new Promise((r) => setTimeout(r, 10));

    expect(app.receivedMessages).toHaveLength(1);
    expect(app.receivedMessages[0].targetSessionId).toBe("owner-1");
    expect(app.receivedMessages[0].source).toBe("delegation");
  });

  it("supervised notification targets owner directly", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });

    const supervisorSession = createMockSession("sup-1");
    const delegateSession = createMockSession("del-1");
    const app = createMockApp([supervisorSession, delegateSession]);
    const tool = createDelegateTool(app as any, store, "owner-1");

    await run(tool, {
      description: "Task",
      spec: "Spec",
      supervised: true,
      criteria: "Criteria",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(app.receivedMessages).toHaveLength(1);
    expect(app.receivedMessages[0].targetSessionId).toBe("owner-1");
    expect(app.receivedMessages[0].source).toBe("delegation");
  });

  it("notify_parent escalation targets parent directly", async () => {
    const store = freshStore();
    store.initSession("owner-1", { sessionType: "chat", title: "Owner" });
    store.initSession("sup-1", {
      parentSessionId: "owner-1",
      sessionType: "supervision",
      title: "Task",
    });

    const app = createMockApp([]);
    const tool = createNotifyParentTool(app as any, store, "sup-1");
    await run(tool, { type: "escalation", message: "Stuck" });

    expect(app.receivedMessages).toHaveLength(1);
    expect(app.receivedMessages[0].targetSessionId).toBe("owner-1");
    expect(app.receivedMessages[0].source).toBe("escalation");
  });

  it("notify_parent completion targets parent directly", async () => {
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
    const tool = createNotifyParentTool(app as any, store, "sup-1");
    await run(tool, { type: "completion", message: "Done" });

    expect(app.receivedMessages).toHaveLength(1);
    expect(app.receivedMessages[0].targetSessionId).toBe("owner-1");
    expect(app.receivedMessages[0].source).toBe("delegation");
  });
});
