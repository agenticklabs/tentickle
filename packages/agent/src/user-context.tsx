import { useState } from "react";
import { Section, useOnMount } from "@agentick/core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getUserDir } from "./paths.js";

/**
 * Loads the agent's owner profile from ~/.tentickle/user/.
 *
 * Reads all .md files in the user directory and concatenates them.
 * This is info the agent maintains about its human — name, goals,
 * communication preferences, current priorities. Updated by the agent
 * over time via write_file.
 */
export function UserContext() {
  const [content, setContent] = useState<string | null>(null);

  useOnMount(async () => {
    const dir = getUserDir();
    try {
      const entries = await readdir(dir);
      const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
      if (mdFiles.length === 0) return;

      const parts: string[] = [];
      for (const file of mdFiles) {
        try {
          const text = await readFile(join(dir, file), "utf-8");
          if (text.trim()) parts.push(text.trim());
        } catch {}
      }
      if (parts.length > 0) setContent(parts.join("\n\n---\n\n"));
    } catch {
      // Directory doesn't exist or can't be read — no user context yet
    }
  });

  if (!content) return null;
  return (
    <Section id="user-context" title="About Your Human">
      {content}
    </Section>
  );
}
