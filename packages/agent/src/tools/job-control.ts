import { createTool } from "@agentick/core";
import type { App, ToolClass } from "@agentick/core";
import type { TentickleSessionStore } from "@tentickle/storage";
import { z } from "zod";

export function createApproveJobTool(app: App, store: TentickleSessionStore): ToolClass {
  return createTool({
    name: "approve_job",
    description: "Approve and finalize a completed delegation. Closes the associated sessions.",
    displaySummary: (input) => `Approve ${input.sessionId.slice(0, 8)}`,
    input: z.object({
      sessionId: z.string().describe("The delegation/supervision session ID to approve"),
    }),
    handler: async ({ sessionId }) => {
      const meta = store.getSessionMeta(sessionId);
      if (!meta) {
        return [{ type: "text" as const, text: `Session ${sessionId} not found` }];
      }

      if (meta.status !== "completed") {
        store.updateSessionMeta(sessionId, { status: "completed" });
        store.setSnapshotValue(sessionId, "result", "Approved by parent");
      }

      // Close this session and any children
      const children = store.getChildSessions(sessionId);
      for (const child of children) {
        store.updateSessionMeta(child.id, { status: "completed" });
        try {
          await app.close(child.id);
        } catch {
          /* already closed */
        }
      }

      try {
        await app.close(sessionId);
      } catch {
        /* already closed */
      }

      return [
        {
          type: "text" as const,
          text: `Session ${sessionId} approved. Sessions closed.`,
        },
      ];
    },
  });
}

export function createCancelJobTool(app: App, store: TentickleSessionStore): ToolClass {
  return createTool({
    name: "cancel_job",
    description: "Cancel a running delegation. Aborts and closes the associated sessions.",
    displaySummary: (input) => `Cancel ${input.sessionId.slice(0, 8)}`,
    input: z.object({
      sessionId: z.string().describe("The delegation/supervision session ID to cancel"),
      reason: z.string().optional().describe("Reason for cancellation"),
    }),
    handler: async ({ sessionId, reason }) => {
      const meta = store.getSessionMeta(sessionId);
      if (!meta) {
        return [{ type: "text" as const, text: `Session ${sessionId} not found` }];
      }

      store.updateSessionMeta(sessionId, { status: "failed" });
      if (reason) {
        store.setSnapshotValue(sessionId, "error", reason);
      }

      // Close children
      const children = store.getChildSessions(sessionId);
      for (const child of children) {
        store.updateSessionMeta(child.id, { status: "failed" });
        try {
          await app.close(child.id);
        } catch {
          /* already closed */
        }
      }

      try {
        await app.close(sessionId);
      } catch {
        /* already closed */
      }

      return [
        {
          type: "text" as const,
          text: `Session ${sessionId} cancelled.${reason ? ` Reason: ${reason}` : ""}`,
        },
      ];
    },
  });
}
