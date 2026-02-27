import { createTool } from "@agentick/core";
import type { App, InboxMessageInput, ToolClass } from "@agentick/core";
import { createEventMessage } from "@agentick/shared";
import { z } from "zod";
import { pipeConfirmations, pipeToolEvents } from "../utils/pipe-confirmations.js";
import { getArtifactStore } from "@tentickle/artifacts";

function inboxMessage(source: string, text: string): InboxMessageInput {
  return {
    source,
    type: "message",
    payload: { role: "user", content: [{ type: "text", text }] },
  };
}

function eventInboxMessage(source: string, text: string, eventType: string): InboxMessageInput {
  return {
    source,
    type: "message",
    payload: createEventMessage(text, eventType),
  };
}

function textResult(text: string) {
  return [{ type: "text" as const, text }];
}

// ---------------------------------------------------------------------------
// delegate — spawn a worker session
// ---------------------------------------------------------------------------

export function createKernelDelegateTool(app: App, ownerSessionId: string): ToolClass {
  return createTool({
    name: "delegate",
    description: `Delegate a task to a background worker agent.

The worker runs autonomously and reports back on completion or failure.
You remain available for other work while workers run in background sessions.`,
    displaySummary: (input) => (input.task ?? "delegation").slice(0, 60),
    input: z.object({
      task: z.string().describe("Short description of the task"),
      spec: z.string().describe("Detailed specification for the worker agent"),
    }),
    handler: async (input) => {
      const ownerSession = await app.session(ownerSessionId);
      const session = await app.session({
        parentSessionId: ownerSessionId,
        metadata: {
          type: "worker",
          origin: ownerSessionId,
          task: input.task,
        },
      });

      // Emit spawn_start so the TUI's SessionTree tracks this worker
      ownerSession.pushEvent({
        type: "spawn_start",
        spawnId: session.id,
        parentExecutionId: "kernel",
        childExecutionId: session.id,
        label: input.task,
      });

      const unpipeConfirm = pipeConfirmations(session, ownerSession);
      const unpipeTools = pipeToolEvents(session, ownerSession, session.id);
      const unpipe = () => {
        unpipeConfirm();
        unpipeTools();
      };

      const handle = await session.send({
        messages: [{ role: "user", content: [{ type: "text", text: input.spec }] }],
      });

      handle.result.then(
        (result) => {
          unpipe();

          // Emit spawn_end so SessionTree shows completion
          ownerSession.pushEvent({
            type: "spawn_end",
            spawnId: session.id,
            parentExecutionId: "kernel",
            childExecutionId: session.id,
            output: null,
          });

          const artifactStore = getArtifactStore();
          const produced = artifactStore?.list(session.id) ?? [];
          const artifactLines =
            produced.length > 0
              ? `\n\nArtifacts:\n${produced.map((a) => `- ${a.name} (${a.type}): ${a.summary ?? a.content.slice(0, 100)}`).join("\n")}`
              : "";
          app
            .receive(
              ownerSessionId,
              eventInboxMessage(
                "worker",
                `[Worker Complete] "${input.task}"\n\nResult: ${result.response.slice(0, 2000)}${artifactLines}`,
                "worker_completion",
              ),
            )
            .catch(() => {});
        },
        (error) => {
          unpipe();

          // Emit spawn_end with error so SessionTree shows failure
          ownerSession.pushEvent({
            type: "spawn_end",
            spawnId: session.id,
            parentExecutionId: "kernel",
            childExecutionId: session.id,
            output: null,
            isError: true,
          });

          const msg = error instanceof Error ? error.message : String(error);
          app
            .receive(
              ownerSessionId,
              eventInboxMessage(
                "worker",
                `[Worker Failed] "${input.task}"\n\nError: ${msg}`,
                "worker_failure",
              ),
            )
            .catch(() => {});
        },
      );

      return textResult(`Worker started: ${session.id}\nTask: ${input.task}`);
    },
  });
}

// ---------------------------------------------------------------------------
// workers — query the process table
// ---------------------------------------------------------------------------

export function createWorkersTool(app: App, ownerSessionId: string): ToolClass {
  return createTool({
    name: "workers",
    description: "List your worker sessions.",
    input: z.object({
      includeCompleted: z.boolean().default(false).describe("Include closed/completed workers"),
    }),
    handler: async (input) => {
      const workers = app.sessions
        .map((id) => app.getSession(id))
        .filter((s): s is NonNullable<typeof s> => s != null)
        .filter((s) => s.metadata?.type === "worker")
        .filter((s) => s.metadata?.origin === ownerSessionId)
        .filter((s) => input.includeCompleted || s.status !== "closed");

      if (workers.length === 0) {
        return textResult("No workers found.");
      }

      const lines = workers.map((s) => {
        const task = (s.metadata.task as string) ?? "(unknown)";
        return `[${s.id.slice(0, 8)}] ${task} — ${s.status}`;
      });

      return textResult(lines.join("\n"));
    },
  });
}

// ---------------------------------------------------------------------------
// cancel — abort a worker
// ---------------------------------------------------------------------------

export function createCancelTool(app: App, ownerSessionId: string): ToolClass {
  return createTool({
    name: "cancel",
    description: "Cancel a running worker session.",
    input: z.object({
      workerId: z.string().describe("Session ID of the worker to cancel"),
    }),
    handler: async (input) => {
      const session = app.getSession(input.workerId);
      if (!session) {
        return textResult(`Worker ${input.workerId} not found.`);
      }
      if (session.metadata?.type !== "worker") {
        return textResult(`Session ${input.workerId} is not a worker.`);
      }
      if (session.metadata?.origin !== ownerSessionId) {
        return textResult(`Worker ${input.workerId} is not owned by this session.`);
      }
      await app.close(input.workerId);
      // TODO: emit spawn_end here so SessionTree shows cancellation immediately
      // instead of waiting for handle.result rejection (which may not fire).
      return textResult(`Worker ${input.workerId} cancelled.`);
    },
  });
}

// ---------------------------------------------------------------------------
// send_worker — send a message to a running worker
// ---------------------------------------------------------------------------

export function createSendWorkerTool(app: App, ownerSessionId: string): ToolClass {
  return createTool({
    name: "send_worker",
    description: "Send instructions to a running worker session.",
    input: z.object({
      workerId: z.string().describe("Session ID of the worker"),
      message: z.string().describe("The message to send"),
    }),
    handler: async (input) => {
      const session = app.getSession(input.workerId);
      if (!session) {
        return textResult(`Worker ${input.workerId} not found.`);
      }
      if (session.metadata?.type !== "worker") {
        return textResult(`Session ${input.workerId} is not a worker.`);
      }
      if (session.metadata?.origin !== ownerSessionId) {
        return textResult(`Worker ${input.workerId} is not owned by this session.`);
      }
      await app.receive(input.workerId, inboxMessage("shell", input.message));
      return textResult(`Message sent to worker ${input.workerId}.`);
    },
  });
}
