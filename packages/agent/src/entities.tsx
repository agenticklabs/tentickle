import { useState } from "react";
import { Grounding, useOnMount } from "@agentick/core";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { getEntitiesDir } from "./paths.js";

interface EntitySummary {
  name: string;
  path: string;
  firstLine: string;
}

/**
 * Discovers entity profiles from ~/.tentickle/entities/ and renders
 * a lightweight index. The agent reads the full profile with read_file
 * when it needs details.
 */
export function EntityAwareness() {
  const [entities, setEntities] = useState<EntitySummary[]>([]);

  useOnMount(async () => {
    const dir = getEntitiesDir();
    try {
      const entries = await readdir(dir);
      const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
      if (mdFiles.length === 0) return;

      const summaries: EntitySummary[] = [];
      for (const file of mdFiles) {
        const path = join(dir, file);
        try {
          const text = await readFile(path, "utf-8");
          const firstLine =
            text
              .split("\n")
              .find((l) => l.trim())
              ?.trim() || "";
          summaries.push({
            name: basename(file, ".md"),
            path,
            firstLine: firstLine.replace(/^#+\s*/, "").slice(0, 80),
          });
        } catch {}
      }
      if (summaries.length > 0) setEntities(summaries);
    } catch {
      // Directory doesn't exist or can't be read — no entities yet
    }
  });

  if (entities.length === 0) return null;

  return (
    <Grounding title="Known Entities">
      {`${entities.length} entity profile(s). Read with read_file when needed.\n\n` +
        entities.map((e) => `- **${e.name}**: ${e.firstLine}\n  Path: ${e.path}`).join("\n")}
    </Grounding>
  );
}
