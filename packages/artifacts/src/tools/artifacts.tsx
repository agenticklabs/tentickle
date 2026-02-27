import { createTool, type ToolClass } from "@agentick/core";
import { z } from "zod";
import type { ArtifactStore } from "../artifact-store.js";

function textResult(text: string) {
  return [{ type: "text" as const, text }];
}

export function createStoreArtifactTool(store: ArtifactStore): ToolClass {
  return createTool({
    name: "store_artifact",
    description:
      "Declare a named output artifact. Use this to register code, documents, " +
      "analyses, schemas, or plans you've produced so they can be referenced " +
      "and consumed by other agents.",
    displaySummary: (input) => `artifact: ${input.name}`,
    input: z.object({
      name: z
        .string()
        .describe("Human-readable identifier (e.g. 'auth-analysis', 'migration-plan')"),
      type: z.string().describe("Category: code, document, analysis, schema, plan, etc."),
      content: z.string().describe("The artifact body"),
      summary: z.string().optional().describe("Optional short description"),
    }),
    handler: (input, ctx) => {
      const entry = store.store(input, ctx?.sessionId ?? undefined);
      return textResult(`Stored artifact ${entry.id}: ${entry.name} (${entry.type})`);
    },
  });
}

export function createGetArtifactTool(store: ArtifactStore): ToolClass {
  return createTool({
    name: "get_artifact",
    description: "Retrieve an artifact by ID or name.",
    displaySummary: (input) => `get: ${input.id ?? input.name ?? "?"}`,
    input: z.object({
      id: z.string().optional().describe("Artifact UUID"),
      name: z.string().optional().describe("Artifact name (returns most recent match)"),
    }),
    handler: (input) => {
      const entry = input.id
        ? store.get(input.id)
        : input.name
          ? store.getByName(input.name)
          : null;
      if (!entry) return textResult("Artifact not found.");
      return textResult(
        JSON.stringify({
          id: entry.id,
          name: entry.name,
          type: entry.type,
          summary: entry.summary,
          content: entry.content,
        }),
      );
    },
  });
}

export function createListArtifactsTool(store: ArtifactStore): ToolClass {
  return createTool({
    name: "list_artifacts",
    description: "List available artifacts, optionally filtered by type.",
    displaySummary: (input) => `list${input.type ? `: ${input.type}` : ""}`,
    input: z.object({
      type: z.string().optional().describe("Filter by artifact type"),
    }),
    handler: (input) => {
      const entries = input.type ? store.listByType(input.type) : store.list();
      if (entries.length === 0) return textResult("No artifacts found.");
      const lines = entries.map(
        (a) => `[${a.id.slice(0, 8)}] ${a.name} (${a.type})${a.summary ? ` — ${a.summary}` : ""}`,
      );
      return textResult(lines.join("\n"));
    },
  });
}
