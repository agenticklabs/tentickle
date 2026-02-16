import { createTool } from "@agentick/core";
import type { ComponentFunction } from "@agentick/core";
import { z } from "zod";

/**
 * Creates a spawn tool that delegates tasks to child agents.
 *
 * The model calls this tool to spin up a sub-agent with a focused objective.
 * For concurrent work, the model calls it multiple times in one response
 * (parallel tool calls). Each spawn gets its own event stream, abort signal,
 * and SpawnIndicator entry in the TUI.
 *
 * @param Agent - The component to spawn. Typically the same agent (self-spawn).
 */
export function createSpawnTool(Agent: ComponentFunction) {
  return createTool({
    name: "spawn",
    description:
      "Delegate a task to a sub-agent that runs independently with full workspace " +
      "access, then reports back with results. Use for research, exploration, " +
      "refactoring sub-tasks, or any work that can proceed in parallel. " +
      "Call multiple times for concurrent delegations.",
    displaySummary: (input) => input.topic.slice(0, 60),
    input: z.object({
      topic: z.string().describe("What the sub-agent should accomplish"),
      prompt: z.string().describe("The prompt and context for the sub-agent"),
      maxTicks: z.number().optional().describe("Max iterations for the sub-agent (default: 20)"),
    }),
    handler: async ({ topic, maxTicks, prompt }, ctx) => {
      const label = topic.length > 50 ? topic.slice(0, 47) + "..." : topic;

      const handle = await ctx!.spawn(
        Agent,
        {
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
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
