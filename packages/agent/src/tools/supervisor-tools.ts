import { createTool } from "@agentick/core";
import type { App, ToolClass } from "@agentick/core";
import { extractText } from "@agentick/shared";
import type { TentickleSessionStore } from "@tentickle/storage";
import { z } from "zod";

// ---------------------------------------------------------------------------
// send_to_delegate — blocking tool, sends message and awaits response
// ---------------------------------------------------------------------------

export function createSendToDelegateTool(app: App, delegateSessionId: string): ToolClass {
  return createTool({
    name: "send_to_delegate",
    description: `Send a message to the coding agent and wait for the response. This is a BLOCKING call — the coding agent will process the message and return when done. Use this to:
- Send the initial spec
- Send feedback about issues found
- Request specific changes or fixes`,
    displaySummary: (input) => input.message.slice(0, 60),
    input: z.object({
      message: z.string().describe("The message to send to the coding agent"),
    }),
    handler: async ({ message }) => {
      const session = await app.session(delegateSessionId);
      const result = await session.send({
        messages: [{ role: "user", content: [{ type: "text", text: message }] }],
      }).result;
      return [{ type: "text" as const, text: result.response }];
    },
  });
}

// ---------------------------------------------------------------------------
// inspect_delegate — read coding session timeline
// ---------------------------------------------------------------------------

export function createInspectDelegateTool(app: App, delegateSessionId: string): ToolClass {
  return createTool({
    name: "inspect_delegate",
    description:
      "View the coding agent's recent conversation timeline. Use this to review what the agent has done without sending a new message.",
    input: z.object({
      lastN: z.number().optional().describe("Number of recent entries to show (default: 10)"),
    }),
    handler: async ({ lastN = 10 }) => {
      const session = await app.session(delegateSessionId);
      const snapshot = session.snapshot();
      const entries = snapshot.timeline ?? [];
      const recent = entries.slice(-lastN);

      const formatted = recent
        .map((entry) => {
          const role = entry.message.role;
          const text = extractText(entry.message.content);
          const preview = text.length > 300 ? text.slice(0, 297) + "..." : text;
          return `[${role}] ${preview}`;
        })
        .join("\n\n---\n\n");

      return [
        {
          type: "text" as const,
          text: formatted || "(no timeline entries)",
        },
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// complete_delegation — mark supervisor session done, notify parent
// ---------------------------------------------------------------------------

export function createCompleteDelegationTool(
  app: App,
  store: TentickleSessionStore,
  supervisorSessionId: string,
): ToolClass {
  return createTool({
    name: "complete_delegation",
    description:
      "Mark the delegation as complete. Call this when all acceptance criteria are met. Provides a summary to the parent session.",
    input: z.object({
      summary: z.string().describe("Summary of what was accomplished and verification results"),
    }),
    handler: async ({ summary }) => {
      const meta = store.getSessionMeta(supervisorSessionId);
      if (!meta) {
        return [{ type: "text" as const, text: `Error: Session ${supervisorSessionId} not found` }];
      }

      store.updateSessionMeta(supervisorSessionId, { status: "completed" });
      store.setSnapshotValue(supervisorSessionId, "result", summary);

      // Close the delegate child session
      const children = store.getChildSessions(supervisorSessionId);
      for (const child of children) {
        if (child.session_type === "delegation") {
          store.updateSessionMeta(child.id, { status: "completed" });
          try {
            await app.close(child.id);
          } catch {
            // Session may already be closed
          }
        }
      }

      // Notify parent session
      if (meta.parent_session_id) {
        await app.receive({
          source: `session:${supervisorSessionId}`,
          type: "message",
          payload: {
            role: "user",
            content: [
              {
                type: "text",
                text: `[Delegation Complete] "${meta.title ?? "task"}"\n\nSummary: ${summary}`,
              },
            ],
          },
        });
      }

      return [{ type: "text" as const, text: "Delegation marked complete. Parent notified." }];
    },
  });
}

// ---------------------------------------------------------------------------
// escalate — notify parent about issues
// ---------------------------------------------------------------------------

export function createEscalateTool(
  app: App,
  store: TentickleSessionStore,
  parentSessionId: string,
  mySessionId: string,
): ToolClass {
  return createTool({
    name: "escalate",
    description:
      "Escalate an issue to the parent session. Use when you're stuck, need clarification, or encountered a problem that requires human intervention.",
    input: z.object({
      reason: z.string().describe("What went wrong or what you need help with"),
    }),
    handler: async ({ reason }) => {
      const meta = store.getSessionMeta(mySessionId);
      const title = meta?.title ?? "unknown task";

      await app.receive({
        source: `session:${mySessionId}`,
        type: "message",
        payload: {
          role: "user",
          content: [
            {
              type: "text",
              text: `[Escalation] "${title}"\n\nReason: ${reason}`,
            },
          ],
        },
      });

      return [{ type: "text" as const, text: "Escalation sent to parent session." }];
    },
  });
}

// ---------------------------------------------------------------------------
// run_verification — shell command execution for supervisor
// ---------------------------------------------------------------------------

export function createRunVerificationTool(): ToolClass {
  return createTool({
    name: "run_verification",
    description:
      "Run a shell command to independently verify the coding agent's work. Use for: pnpm test, pnpm typecheck, pnpm lint, etc.",
    input: z.object({
      command: z.string().describe("The shell command to run"),
    }),
    handler: async ({ command }) => {
      const { execSync } = await import("node:child_process");
      try {
        const output = execSync(command, {
          encoding: "utf-8",
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        });
        return [{ type: "text" as const, text: output.slice(0, 5000) }];
      } catch (error: any) {
        const output = (error.stdout ?? "") + "\n" + (error.stderr ?? "");
        return [
          {
            type: "text" as const,
            text: `Command failed (exit ${error.status}):\n${output.slice(0, 5000)}`,
          },
        ];
      }
    },
  });
}
