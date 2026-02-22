import { createTool } from "@agentick/core";
import type { App, ToolClass } from "@agentick/core";
import { extractText } from "@agentick/shared";
import type { TentickleSessionStore } from "@tentickle/storage";
import { z } from "zod";

export function createInspectJobTool(app: App, store: TentickleSessionStore): ToolClass {
  return createTool({
    name: "inspect_job",
    description:
      "Inspect a delegated session's status and recent activity. Shows the coding agent's conversation timeline.",
    displaySummary: (input) => `Inspect ${input.sessionId.slice(0, 8)}`,
    input: z.object({
      sessionId: z.string().describe("The delegation session ID to inspect"),
      lastN: z
        .number()
        .optional()
        .describe("Number of recent timeline entries to show (default: 10)"),
    }),
    handler: async ({ sessionId, lastN = 10 }) => {
      const meta = store.getSessionMeta(sessionId);
      if (!meta) {
        return [{ type: "text" as const, text: `Session ${sessionId} not found` }];
      }

      const objective = store.getSnapshotValue(sessionId, "objective") ?? "";
      const result = store.getSnapshotValue(sessionId, "result");
      const error = store.getSnapshotValue(sessionId, "error");
      const followUpError = store.getSnapshotValue(sessionId, "follow_up_error");
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
        followUpError ? `Follow-up Error: ${followUpError}` : "",
        notificationError ? `Notification Error: ${notificationError}` : "",
        `Created: ${new Date(meta.created_at).toISOString()}`,
        `Updated: ${new Date(meta.updated_at).toISOString()}`,
        "",
        "--- Recent Timeline ---",
      ].filter(Boolean);

      // Read timeline from session snapshot
      try {
        const session = await app.session(sessionId);
        const snapshot = session.snapshot();
        const entries = snapshot.timeline ?? [];
        const recent = entries.slice(-lastN);

        for (const entry of recent) {
          const role = entry.message.role;
          const text = extractText(entry.message.content);
          const preview = text.length > 300 ? text.slice(0, 297) + "..." : text;
          lines.push(`[${role}] ${preview}`);
        }

        if (recent.length === 0) {
          lines.push("(no timeline entries)");
        }
      } catch {
        lines.push("(session not available)");
      }

      return [{ type: "text" as const, text: lines.join("\n") }];
    },
  });
}
