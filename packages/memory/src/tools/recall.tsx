import { createTool, type ToolClass } from "@agentick/core";
import { z } from "zod";
import type { TentickleMemory } from "../tentickle-memory.js";

export function createRecallTool(memory: TentickleMemory): ToolClass {
  return createTool({
    name: "recall",
    description:
      "Search your memory using keyword matching and semantic similarity. " +
      "Use natural language — both exact keywords and conceptual queries work.",
    displaySummary: (input) => `recall: ${input.query.slice(0, 60)}`,
    input: z.object({
      query: z.string().describe("What to search for"),
      topic: z.string().optional().describe("Filter by topic"),
      limit: z.number().optional().describe("Max results (default 10)"),
    }),
    handler: async (input) => {
      const result = await memory.recall(input);
      if (result.entries.length === 0) {
        return [{ type: "text" as const, text: "No relevant memories found." }];
      }
      return result.entries.map((e) => ({
        type: "text" as const,
        text: JSON.stringify({ content: e.content, topic: e.topic, score: e.score, id: e.id }),
      }));
    },
  });
}
