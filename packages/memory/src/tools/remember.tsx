import { createTool, type ToolClass } from "@agentick/core";
import { z } from "zod";
import type { TentickleMemory } from "../tentickle-memory.js";

export function createRememberTool(memory: TentickleMemory): ToolClass {
  return createTool({
    name: "remember",
    description:
      "Store knowledge for future recall. Write naturally — " +
      "keyword and semantic search are used for retrieval.",
    displaySummary: (input) => `remember: ${input.content.slice(0, 60)}`,
    input: z.object({
      content: z.string().describe("The knowledge to remember"),
      topic: z.string().optional().describe("Category/topic for organization"),
      importance: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("0-1 importance score (default 0.5)"),
    }),
    handler: (input) => {
      const entry = memory.remember(input);
      return [{ type: "text" as const, text: `Remembered (${entry.id}): ${entry.content}` }];
    },
  });
}
