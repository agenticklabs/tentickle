import { createTool } from "@agentick/core";
import type { App, InboxMessageInput, ToolClass } from "@agentick/core";
import { z } from "zod";
import { pipeConfirmations } from "../utils/pipe-confirmations.js";

function inboxMessage(source: string, text: string): InboxMessageInput {
  return {
    source,
    type: "message",
    payload: { role: "user", content: [{ type: "text", text }] },
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

      const unpipe = pipeConfirmations(session, ownerSession);

      const handle = await session.send({
        messages: [{ role: "user", content: [{ type: "text", text: input.spec }] }],
      });

      handle.result.then(
        (result) => {
          unpipe();
          app
            .receive(
              ownerSessionId,
              inboxMessage(
                "worker",
                `[Worker Complete] "${input.task}"\n\nResult: ${result.response.slice(0, 2000)}`,
              ),
            )
            .catch(() => {});
        },
        (error) => {
          unpipe();
          const msg = error instanceof Error ? error.message : String(error);
          app
            .receive(
              ownerSessionId,
              inboxMessage("worker", `[Worker Failed] "${input.task}"\n\nError: ${msg}`),
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
    description: "List worker sessions. Defaults to your own workers.",
    input: z.object({
      filter: z
        .enum(["all", "active", "mine"])
        .default("mine")
        .describe("all = every worker, active = non-terminal workers, mine = workers I spawned"),
    }),
    handler: async (input) => {
      const workers = app.sessions
        .map((id) => app.getSession(id))
        .filter((s): s is NonNullable<typeof s> => s != null)
        .filter((s) => s.metadata?.type === "worker")
        .filter((s) => {
          switch (input.filter) {
            case "all":
              return true;
            case "active":
              return s.status !== "closed";
            case "mine":
              return s.metadata?.origin === ownerSessionId;
          }
        });

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

export function createCancelTool(app: App): ToolClass {
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
      await app.close(input.workerId);
      return textResult(`Worker ${input.workerId} cancelled.`);
    },
  });
}

// ---------------------------------------------------------------------------
// send_worker — send a message to a running worker
// ---------------------------------------------------------------------------

export function createSendWorkerTool(app: App): ToolClass {
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
      await app.receive(input.workerId, inboxMessage("shell", input.message));
      return textResult(`Message sent to worker ${input.workerId}.`);
    },
  });
}
