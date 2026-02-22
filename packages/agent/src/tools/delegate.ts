import { createTool } from "@agentick/core";
import type { App, Session, ToolClass } from "@agentick/core";
import type { TentickleSessionStore } from "@tentickle/storage";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Confirmation routing — pipe confirmations between independent sessions
// ---------------------------------------------------------------------------

function pipeConfirmations(from: Session, to: Session): () => void {
  const childCallIds = new Set<string>();

  const onEvent = (event: any) => {
    if (event.type === "tool_confirmation_required") {
      childCallIds.add(event.callId);
      to.pushEvent(event);
    }
  };
  from.on("event", onEvent);

  const unsubChannel = to.channel("tool_confirmation").subscribe((event: any) => {
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
// Dispatch mode — fire-and-forget autonomous delegation
// ---------------------------------------------------------------------------

async function handleDispatch(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
  description: string,
  spec: string,
): Promise<{ sessionId: string }> {
  const session = await app.session();
  const ownerSession = await app.session(ownerSessionId);

  // Route tool confirmations from delegate → owner TUI → delegate
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

  // Background: await completion, notify parent, update status
  handle.result.then(
    (result) => {
      unpipe();
      store.updateSessionMeta(session.id, { status: "completed" });
      store.setSnapshotValue(session.id, "result", result.response.slice(0, 2000));
      app
        .receive({
          source: `session:${session.id}`,
          type: "message",
          payload: {
            role: "user",
            content: [
              {
                type: "text",
                text: `[Delegation Complete] "${description}"\n\nResult: ${result.response}`,
              },
            ],
          },
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          store.setSnapshotValue(session.id, "notification_error", msg);
        });
    },
    (error) => {
      unpipe();
      store.updateSessionMeta(session.id, { status: "failed" });
      const msg = error instanceof Error ? error.message : String(error);
      store.setSnapshotValue(session.id, "error", msg);
      app
        .receive({
          source: `session:${session.id}`,
          type: "message",
          payload: {
            role: "user",
            content: [
              {
                type: "text",
                text: `[Delegation Failed] "${description}"\n\nError: ${msg}`,
              },
            ],
          },
        })
        .catch((err: unknown) => {
          const m = err instanceof Error ? err.message : String(err);
          store.setSnapshotValue(session.id, "notification_error", m);
        });
    },
  );

  return { sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Supervised mode — create delegate + supervisor sessions
// ---------------------------------------------------------------------------

async function handleSupervised(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
  description: string,
  spec: string,
  criteria: string,
): Promise<{ delegateSessionId: string; supervisorSessionId: string }> {
  const delegateSession = await app.session();
  const supervisorSession = await app.session();
  const ownerSession = await app.session(ownerSessionId);

  // Route tool confirmations from both sessions → owner TUI → back
  const unpipeDelegate = pipeConfirmations(delegateSession, ownerSession);
  const unpipeSupervisor = pipeConfirmations(supervisorSession, ownerSession);

  // Supervisor is child of owner
  store.initSession(supervisorSession.id, {
    parentSessionId: ownerSessionId,
    sessionType: "supervision",
    title: description,
    status: "active",
  });
  store.setSnapshotValue(supervisorSession.id, "objective", spec);
  store.setSnapshotValue(supervisorSession.id, "criteria", criteria);

  // Delegate is child of supervisor
  store.initSession(delegateSession.id, {
    parentSessionId: supervisorSession.id,
    sessionType: "delegation",
    title: description,
    status: "active",
  });
  store.setSnapshotValue(delegateSession.id, "objective", spec);

  // Mount delegate so it's ready when supervisor sends to it
  await delegateSession.mount();

  // Send spec + criteria to supervisor
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
              "Use send_to_delegate to instruct the coding agent. Use run_verification to independently check. Call complete_delegation when criteria are met.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  // Background: await supervisor completion, notify parent
  handle.result.then(
    (result) => {
      unpipeDelegate();
      unpipeSupervisor();
      // Supervisor calls complete_delegation which updates status,
      // but if it ends without calling it, mark completed anyway
      const meta = store.getSessionMeta(supervisorSession.id);
      if (meta?.status === "active") {
        store.updateSessionMeta(supervisorSession.id, { status: "completed" });
        store.setSnapshotValue(supervisorSession.id, "result", result.response.slice(0, 2000));
      }
      store.updateSessionMeta(delegateSession.id, { status: "completed" });
      app
        .receive({
          source: `session:${supervisorSession.id}`,
          type: "message",
          payload: {
            role: "user",
            content: [
              {
                type: "text",
                text: `[Supervised Delegation Complete] "${description}"\n\nResult: ${result.response}`,
              },
            ],
          },
        })
        .catch((err: unknown) => {
          const m = err instanceof Error ? err.message : String(err);
          store.setSnapshotValue(supervisorSession.id, "notification_error", m);
        });
    },
    (error) => {
      unpipeDelegate();
      unpipeSupervisor();
      const msg = error instanceof Error ? error.message : String(error);
      store.updateSessionMeta(supervisorSession.id, { status: "failed" });
      store.setSnapshotValue(supervisorSession.id, "error", msg);
      store.updateSessionMeta(delegateSession.id, { status: "failed" });
      app
        .receive({
          source: `session:${supervisorSession.id}`,
          type: "message",
          payload: {
            role: "user",
            content: [
              {
                type: "text",
                text: `[Supervised Delegation Failed] "${description}"\n\nError: ${msg}`,
              },
            ],
          },
        })
        .catch((err: unknown) => {
          const m = err instanceof Error ? err.message : String(err);
          store.setSnapshotValue(supervisorSession.id, "notification_error", m);
        });
    },
  );

  return {
    delegateSessionId: delegateSession.id,
    supervisorSessionId: supervisorSession.id,
  };
}

// ---------------------------------------------------------------------------
// Follow-up — send additional message to existing delegation session
// ---------------------------------------------------------------------------

async function handleFollowUp(
  app: App,
  store: TentickleSessionStore,
  sessionId: string,
  message: string,
): Promise<string> {
  const meta = store.getSessionMeta(sessionId);
  if (!meta) throw new Error(`Session ${sessionId} not found`);
  if (meta.session_type !== "delegation" && meta.session_type !== "supervision") {
    throw new Error(`Session ${sessionId} is type '${meta.session_type}', not a delegation`);
  }

  // For supervised delegations, send to the supervisor session
  const targetId =
    meta.session_type === "supervision"
      ? sessionId
      : (() => {
          // Check if this delegate's parent is a supervisor — if so, target the supervisor
          const parent = meta.parent_session_id
            ? store.getSessionMeta(meta.parent_session_id)
            : null;
          return parent?.session_type === "supervision" ? parent.id : sessionId;
        })();

  const session = await app.session(targetId);
  const handle = await session.send({
    messages: [{ role: "user", content: [{ type: "text", text: message }] }],
  });
  handle.result.catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    store.setSnapshotValue(targetId, "follow_up_error", msg);
  });

  return `Follow-up sent to session ${targetId}`;
}

// ---------------------------------------------------------------------------
// createDelegateTool
// ---------------------------------------------------------------------------

export function createDelegateTool(
  app: App,
  store: TentickleSessionStore,
  ownerSessionId: string,
): ToolClass {
  return createTool({
    name: "delegate",
    description: `Delegate a task to a background agent that works independently.

Two modes:
- Dispatch (supervised=false, default): Fire-and-forget. Agent works autonomously, self-verifies, reports back on completion.
- Supervised (supervised=true): A supervisor agent reviews the coding agent's work against acceptance criteria, sends feedback, loops until criteria are met.

Use delegate for tasks that take many iterations and don't need your direct involvement. You remain available for other work while delegations run.

To send follow-up messages to an existing delegation, provide the sessionId and message fields.`,
    displaySummary: (input) =>
      input.sessionId
        ? `Follow-up: ${input.message?.slice(0, 40) ?? "..."}`
        : (input.description ?? "delegation").slice(0, 60),
    input: z.object({
      description: z.string().optional().describe("Short description of the task"),
      spec: z.string().optional().describe("Detailed specification for the delegate agent"),
      supervised: z.boolean().optional().describe("If true, a supervisor agent reviews the work"),
      supervisorCriteria: z
        .string()
        .optional()
        .describe("Required when supervised=true. Acceptance criteria for the supervisor."),
      sessionId: z.string().optional().describe("Existing delegation session ID for follow-ups"),
      message: z.string().optional().describe("Follow-up message for an existing delegation"),
    }),
    handler: async (input) => {
      // Follow-up mode
      if (input.sessionId) {
        if (!input.message) {
          return [{ type: "text" as const, text: "Error: message is required for follow-up" }];
        }
        const result = await handleFollowUp(app, store, input.sessionId, input.message);
        return [{ type: "text" as const, text: result }];
      }

      // New delegation
      if (!input.description || !input.spec) {
        return [
          {
            type: "text" as const,
            text: "Error: description and spec are required for new delegations",
          },
        ];
      }

      if (input.supervised && !input.supervisorCriteria) {
        return [
          {
            type: "text" as const,
            text: "Error: supervisorCriteria is required when supervised=true",
          },
        ];
      }

      if (input.supervised) {
        const { delegateSessionId, supervisorSessionId } = await handleSupervised(
          app,
          store,
          ownerSessionId,
          input.description,
          input.spec,
          input.supervisorCriteria!,
        );
        return [
          {
            type: "text" as const,
            text: [
              "Delegation started (supervised)",
              `Delegate session: ${delegateSessionId}`,
              `Supervisor session: ${supervisorSessionId}`,
              `Description: ${input.description}`,
            ].join("\n"),
          },
        ];
      }

      const { sessionId } = await handleDispatch(
        app,
        store,
        ownerSessionId,
        input.description,
        input.spec,
      );
      return [
        {
          type: "text" as const,
          text: [
            "Delegation started (dispatch)",
            `Session: ${sessionId}`,
            `Description: ${input.description}`,
          ].join("\n"),
        },
      ];
    },
  });
}
