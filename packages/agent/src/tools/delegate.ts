import { createTool } from "@agentick/core";
import type { App, InboxMessageInput, Session, ToolClass } from "@agentick/core";
import type { ToolConfirmationRequiredEvent, ChannelEvent } from "@agentick/shared";
import { createEventMessage, extractText } from "@agentick/shared";
import type { TentickleSessionStore } from "@tentickle/storage";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Confirmation routing — pipe confirmations between independent sessions
// ---------------------------------------------------------------------------

function pipeConfirmations(from: Session, to: Session): () => void {
  const childCallIds = new Set<string>();

  const onEvent = (event: ToolConfirmationRequiredEvent | { type: string }) => {
    if (event.type === "tool_confirmation_required" && "callId" in event) {
      childCallIds.add(event.callId);
      to.pushEvent({ ...event });
    }
  };
  from.on("event", onEvent);

  const unsubChannel = to.channel("tool_confirmation").subscribe((event: ChannelEvent) => {
    if (event.type === "response" && event.id && childCallIds.has(event.id)) {
      from.channel("tool_confirmation").publish(event);
      childCallIds.delete(event.id);
    }
  });

  return () => {
    from.removeListener("event", onEvent);
    unsubChannel();
    childCallIds.clear();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function textResult(text: string) {
  return [{ type: "text" as const, text }];
}

function eventInboxMessage(source: string, text: string, eventType: string): InboxMessageInput {
  return {
    source,
    type: "message",
    payload: createEventMessage(text, eventType),
  };
}

function isOwnedBy(store: TentickleSessionStore, sessionId: string, ownerId: string): boolean {
  const maxDepth = 10;
  let current = sessionId;
  for (let i = 0; i < maxDepth; i++) {
    const meta = store.getSessionMeta(current);
    if (!meta?.parent_session_id) return false;
    if (meta.parent_session_id === ownerId) return true;
    current = meta.parent_session_id;
  }
  return false;
}

async function closeChildren(
  app: App,
  store: TentickleSessionStore,
  sessionId: string,
  status: "completed" | "failed",
): Promise<void> {
  for (const child of store.getChildSessions(sessionId)) {
    store.updateSessionMeta(child.id, { status });
    try {
      await app.close(child.id);
    } catch {
      /* already closed */
    }
  }
}

async function closeTree(
  app: App,
  store: TentickleSessionStore,
  sessionId: string,
  status: "completed" | "failed",
): Promise<void> {
  await closeChildren(app, store, sessionId, status);
  store.updateSessionMeta(sessionId, { status });
  try {
    await app.close(sessionId);
  } catch {
    /* already closed */
  }
}

// ---------------------------------------------------------------------------
// Settle — shared completion/failure logic for background handlers
// ---------------------------------------------------------------------------

function settleDelegation(opts: {
  unpipe: () => void;
  app: App;
  store: TentickleSessionStore;
  sessionId: string;
  ownerSessionId: string;
  description: string;
  extraSessionIds?: string[];
}) {
  const { unpipe, app, store, sessionId, ownerSessionId, description, extraSessionIds } = opts;

  return {
    onSuccess(result: { response: string }) {
      unpipe();
      const meta = store.getSessionMeta(sessionId);
      if (meta?.status !== "active") return;
      store.updateSessionMeta(sessionId, { status: "completed" });
      store.setSnapshotValue(sessionId, "result", result.response.slice(0, 2000));
      for (const id of extraSessionIds ?? []) {
        store.updateSessionMeta(id, { status: "completed" });
      }
      app
        .receive(
          ownerSessionId,
          eventInboxMessage(
            "delegation",
            `[Delegation Complete] "${description}"\n\nResult: ${result.response}`,
            "delegation_completion",
          ),
        )
        .catch((err: unknown) => {
          store.setSnapshotValue(sessionId, "notification_error", errorMsg(err));
        });
    },
    onError(error: unknown) {
      unpipe();
      const msg = errorMsg(error);
      store.updateSessionMeta(sessionId, { status: "failed" });
      store.setSnapshotValue(sessionId, "error", msg);
      for (const id of extraSessionIds ?? []) {
        store.updateSessionMeta(id, { status: "failed" });
      }
      app
        .receive(
          ownerSessionId,
          eventInboxMessage(
            "delegation",
            `[Delegation Failed] "${description}"\n\nError: ${msg}`,
            "delegation_failure",
          ),
        )
        .catch((err: unknown) => {
          store.setSnapshotValue(sessionId, "notification_error", errorMsg(err));
        });
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch — fire-and-forget autonomous delegation
// ---------------------------------------------------------------------------

async function handleDispatch(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
  description: string,
  spec: string,
): Promise<string> {
  const session = await app.session({ parentSessionId: ownerSessionId });
  const ownerSession = await app.session(ownerSessionId);
  const unpipe = pipeConfirmations(session, ownerSession);

  store.initSession(session.id, {
    parentSessionId: ownerSessionId,
    sessionType: "delegation",
    title: description,
    status: "active",
  });
  store.setSnapshotValue(session.id, "objective", spec);

  const handle = await session.send({
    messages: [{ role: "user", content: [{ type: "text", text: spec }] }],
  });

  const { onSuccess, onError } = settleDelegation({
    unpipe,
    app,
    store,
    sessionId: session.id,
    ownerSessionId,
    description,
  });
  handle.result.then(onSuccess, onError);

  return session.id;
}

// ---------------------------------------------------------------------------
// Supervised — supervisor + delegate sessions
// ---------------------------------------------------------------------------

async function handleSupervised(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
  description: string,
  spec: string,
  criteria: string,
): Promise<{ delegateSessionId: string; supervisorSessionId: string }> {
  const supervisorSession = await app.session({ parentSessionId: ownerSessionId });
  const delegateSession = await app.session({ parentSessionId: supervisorSession.id });
  const ownerSession = await app.session(ownerSessionId);

  const unpipeDelegate = pipeConfirmations(delegateSession, ownerSession);
  const unpipeSupervisor = pipeConfirmations(supervisorSession, ownerSession);

  store.initSession(supervisorSession.id, {
    parentSessionId: ownerSessionId,
    sessionType: "supervision",
    title: description,
    status: "active",
  });
  store.setSnapshotValue(supervisorSession.id, "objective", spec);
  store.setSnapshotValue(supervisorSession.id, "criteria", criteria);

  store.initSession(delegateSession.id, {
    parentSessionId: supervisorSession.id,
    sessionType: "delegation",
    title: description,
    status: "active",
  });
  store.setSnapshotValue(delegateSession.id, "objective", spec);

  await delegateSession.mount();

  const handle = await supervisorSession.send({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `## Delegation: ${description}`,
              "",
              "### Spec",
              spec,
              "",
              "### Acceptance Criteria",
              criteria,
              "",
              `Delegate session: ${delegateSession.id}`,
              'Use send_session to instruct the delegate. Use run_verification to independently check. Use notify_parent with type "completion" when criteria are met.',
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const unpipe = () => {
    unpipeDelegate();
    unpipeSupervisor();
  };
  const { onSuccess, onError } = settleDelegation({
    unpipe,
    app,
    store,
    sessionId: supervisorSession.id,
    ownerSessionId,
    description,
    extraSessionIds: [delegateSession.id],
  });
  handle.result.then(onSuccess, onError);

  return {
    delegateSessionId: delegateSession.id,
    supervisorSessionId: supervisorSession.id,
  };
}

// ---------------------------------------------------------------------------
// 1. delegate — create child sessions
// ---------------------------------------------------------------------------

export function createDelegateTool(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
): ToolClass {
  return createTool({
    name: "delegate",
    description: `Delegate a task to a background agent.

Two modes:
- Dispatch (default): Fire-and-forget. Agent works autonomously, reports on completion.
- Supervised (supervised=true): A supervisor reviews the coding agent's work against criteria.

You remain available for other work while delegations run in background.`,
    displaySummary: (input) => (input.description ?? "delegation").slice(0, 60),
    input: z.object({
      description: z.string().describe("Short description of the task"),
      spec: z.string().describe("Detailed specification for the delegate agent"),
      supervised: z.boolean().optional().describe("If true, a supervisor agent reviews the work"),
      criteria: z
        .string()
        .optional()
        .describe("Acceptance criteria (required when supervised=true)"),
    }),
    handler: async (input) => {
      if (input.supervised && !input.criteria) {
        return textResult("Error: criteria required when supervised=true");
      }

      if (input.supervised) {
        const { delegateSessionId, supervisorSessionId } = await handleSupervised(
          app,
          store,
          ownerSessionId,
          input.description,
          input.spec,
          input.criteria!,
        );
        return textResult(
          `Supervised delegation started\nSupervisor: ${supervisorSessionId}\nDelegate: ${delegateSessionId}`,
        );
      }

      const sessionId = await handleDispatch(
        app,
        store,
        ownerSessionId,
        input.description,
        input.spec,
      );
      return textResult(`Delegation started (dispatch)\nSession: ${sessionId}`);
    },
  });
}

// ---------------------------------------------------------------------------
// 2. send_session — blocking message to any session
// ---------------------------------------------------------------------------

export function createSendSessionTool(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
): ToolClass {
  return createTool({
    name: "send_session",
    description:
      "Send a message to a child session and wait for the response. The target agent processes your message and you receive its response.",
    displaySummary: (input) => input.message.slice(0, 60),
    input: z.object({
      sessionId: z.string().describe("Target session ID"),
      message: z.string().describe("The message to send"),
    }),
    handler: async ({ sessionId, message }) => {
      const meta = store.getSessionMeta(sessionId);
      if (!meta) {
        return textResult(`Session ${sessionId} not found.`);
      }
      if (meta.parent_session_id !== ownerSessionId) {
        return textResult(`Session ${sessionId} is not owned by this session.`);
      }
      const session = await app.session(sessionId);
      const result = await session.send({
        messages: [{ role: "user", content: [{ type: "text", text: message }] }],
      }).result;
      return textResult(result.response);
    },
  });
}

// ---------------------------------------------------------------------------
// 3. notify_parent — escalate or complete
// ---------------------------------------------------------------------------

export function createNotifyParentTool(
  app: App,
  store: TentickleSessionStore,
  sessionId: string,
): ToolClass {
  return createTool({
    name: "notify_parent",
    description: `Notify the parent session.
- completion: Mark this session done and report results. Closes delegate children.
- escalation: Report a problem without closing. Use when stuck or need guidance.`,
    input: z.object({
      type: z.enum(["completion", "escalation"]).describe("Notification type"),
      message: z.string().describe("Summary of results or reason for escalation"),
    }),
    handler: async ({ type, message }) => {
      const meta = store.getSessionMeta(sessionId);
      if (!meta?.parent_session_id) {
        return textResult("Error: no parent session");
      }

      const title = meta.title ?? "task";

      if (type === "completion") {
        store.updateSessionMeta(sessionId, { status: "completed" });
        store.setSnapshotValue(sessionId, "result", message);
        await closeChildren(app, store, sessionId, "completed");

        await app.receive(
          meta.parent_session_id,
          eventInboxMessage(
            "delegation",
            `[Delegation Complete] "${title}"\n\nSummary: ${message}`,
            "delegation_completion",
          ),
        );
        return textResult("Marked complete. Parent notified.");
      }

      await app.receive(
        meta.parent_session_id,
        eventInboxMessage(
          "escalation",
          `[Escalation] "${title}"\n\nReason: ${message}`,
          "delegation_escalation",
        ),
      );
      return textResult("Escalation sent to parent.");
    },
  });
}

// ---------------------------------------------------------------------------
// 4. sessions — list, inspect, close delegated sessions
// ---------------------------------------------------------------------------

export function createSessionsTool(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
): ToolClass {
  return createTool({
    name: "sessions",
    description: `Manage delegated sessions.
- list: Show all active delegations.
- inspect: View a session's status, stats, and recent timeline.
- close: Close a session and its children (approve or cancel).`,
    input: z.object({
      action: z.enum(["list", "inspect", "close"]).describe("Action to perform"),
      sessionId: z.string().optional().describe("Session ID (required for inspect/close)"),
      status: z
        .enum(["completed", "cancelled"])
        .optional()
        .describe("Close status (default: completed)"),
      reason: z.string().optional().describe("Reason for closing"),
      lastN: z.number().optional().describe("Timeline entries to show (default: 10)"),
    }),
    handler: async ({ action, sessionId, status, reason, lastN = 10 }) => {
      if (action === "list") {
        const active = store.getActiveDelegations(ownerSessionId);
        if (active.length === 0) {
          return textResult("No active delegations.");
        }
        const lines = active.map((row) => {
          const stats = store.getSessionStats(row.id);
          return `[${row.id.slice(0, 8)}] ${row.title ?? "(untitled)"} — ${row.status} (${row.session_type}, ${stats.tickCount} ticks, ${stats.toolCallCount} tools)`;
        });
        return textResult(lines.join("\n"));
      }

      if (!sessionId) {
        return textResult("Error: sessionId required");
      }

      if (!isOwnedBy(store, sessionId, ownerSessionId)) {
        return textResult(`Session ${sessionId} is not owned by this session.`);
      }

      if (action === "close") {
        const finalStatus = status === "cancelled" ? "failed" : "completed";
        await closeTree(app, store, sessionId, finalStatus);
        if (reason) {
          store.setSnapshotValue(sessionId, status === "cancelled" ? "error" : "result", reason);
        }
        return textResult(`Session ${sessionId} ${status ?? "completed"}.`);
      }

      // inspect
      const meta = store.getSessionMeta(sessionId);
      if (!meta) {
        return textResult(`Session ${sessionId} not found`);
      }

      const objective = store.getSnapshotValue(sessionId, "objective") ?? "";
      const result = store.getSnapshotValue(sessionId, "result");
      const error = store.getSnapshotValue(sessionId, "error");
      const notificationError = store.getSnapshotValue(sessionId, "notification_error");
      const stats = store.getSessionStats(sessionId);

      const lines = [
        `Session: ${meta.id}`,
        `Title: ${meta.title ?? "(untitled)"}`,
        `Status: ${meta.status}`,
        `Type: ${meta.session_type}`,
        `Parent: ${meta.parent_session_id ?? "(none)"}`,
        `Ticks: ${stats.tickCount} | Tool calls: ${stats.toolCallCount}`,
        objective ? `Objective: ${objective.slice(0, 200)}` : "",
        result ? `Result: ${result.slice(0, 200)}` : "",
        error ? `Error: ${error}` : "",
        notificationError ? `Notification Error: ${notificationError}` : "",
        "",
        "--- Recent Timeline ---",
      ].filter(Boolean);

      try {
        const session = await app.session(sessionId);
        const snapshot = session.snapshot();
        const entries = (snapshot.timeline ?? []).slice(-lastN);
        for (const entry of entries) {
          const role = entry.message.role;
          const t = extractText(entry.message.content);
          const preview = t.length > 300 ? t.slice(0, 297) + "..." : t;
          lines.push(`[${role}] ${preview}`);
        }
        if (entries.length === 0) lines.push("(no timeline entries)");
      } catch {
        lines.push("(session not available)");
      }

      return textResult(lines.join("\n"));
    },
  });
}

// ---------------------------------------------------------------------------
// 5. run_verification — shell access for supervisor
// ---------------------------------------------------------------------------

export function createRunVerificationTool(): ToolClass {
  return createTool({
    name: "run_verification",
    description:
      "Run a shell command to verify work. Use for: pnpm test, pnpm typecheck, pnpm lint, etc.",
    input: z.object({
      command: z.string().describe("The shell command to run"),
    }),
    handler: async ({ command }) => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      try {
        const { stdout, stderr } = await exec("sh", ["-c", command], {
          encoding: "utf-8",
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        });
        const output = (stdout + (stderr ? "\n" + stderr : "")).trim();
        return textResult(output.slice(0, 5000));
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; code?: number | string };
        const output = ((err.stdout ?? "") + "\n" + (err.stderr ?? "")).trim();
        return textResult(`Command failed (exit ${err.code}):\n${output.slice(0, 5000)}`);
      }
    },
  });
}
