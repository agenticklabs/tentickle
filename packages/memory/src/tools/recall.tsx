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
      const blocks: { type: "text"; text: string }[] = [];

      if (result.entries.length === 0) {
        blocks.push({ type: "text", text: "No relevant memories found." });
      } else {
        for (const e of result.entries) {
          blocks.push({
            type: "text",
            text: JSON.stringify({ content: e.content, topic: e.topic, score: e.score, id: e.id }),
          });
        }
      }

      const { hints } = result;
      if (hints.topicMap.length > 0 || hints.relatedTopics.length > 0) {
        const lines: string[] = ["[Memory hints]"];
        if (hints.matchedTopics.length > 0)
          lines.push(`Matched topics: ${hints.matchedTopics.join(", ")}`);
        if (hints.relatedTopics.length > 0)
          lines.push(`Related topics: ${hints.relatedTopics.join(", ")}`);
        if (hints.topicMap.length > 0) {
          const str = hints.topicMap.map((t) => `${t.topic} (${t.count})`).join(", ");
          lines.push(`All topics: ${str}`);
        }
        blocks.push({ type: "text", text: lines.join("\n") });
      }

      return blocks;
    },
  });
}
