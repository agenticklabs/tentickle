import { createTool } from "@agentick/core";
import type { ComponentFunction, ToolClass } from "@agentick/core";
import { z } from "zod";

/**
 * Creates an explore tool that spawns a sub-agent for exploratory tasks.
 *
 * The sub-agent has access to all tools, including 'spawn' and 'explore',
 * allowing for recursive exploration or task delegation.
 *
 * @param Agent - The component to spawn. Typically the same agent (self-spawn).
 */
export function createExploreTool(Agent: ComponentFunction): ToolClass {
  return createTool({
    name: "explore",
    description:
      "Spawn a sub-agent for exploratory tasks. The sub-agent has full workspace access " +
      "and can itself spawn further sub-agents. Use for open-ended research, " +
      "codebase understanding, or discovering solutions.",
    displaySummary: (input) => input.topic.slice(0, 60),
    input: z.object({
      topic: z.string().describe("What the sub-agent should explore or research"),
      prompt: z.string().describe("The prompt and context for the exploration agent"),
      maxTicks: z.number().optional().describe("Max iterations for the sub-agent (default: 20)"),
    }),
    handler: async ({ topic, maxTicks, prompt }, ctx) => {
      const label = topic.length > 50 ? topic.slice(0, 47) + "..." : topic;

      const handle = await ctx!.spawn(
        Agent,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: `Explore: ${topic}. Context: ${prompt}` }],
            },
          ],
        },
        {
          label,
          maxTicks: maxTicks ?? 20,
        },
      );

      const result = await handle.result;
      return [{ type: "text" as const, text: result.response }];
    },
  });
}
