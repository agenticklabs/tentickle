import { useState } from "react";
import { Grounding, useOnMount } from "@agentick/core";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { getGlobalRulesDir, getProjectRulesDir } from "./paths.js";

const INLINE_THRESHOLD = 3000;

interface RuleFile {
  name: string;
  path: string;
  firstLine: string;
  content: string;
}

async function discoverRules(dir: string): Promise<RuleFile[]> {
  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
    const rules: RuleFile[] = [];
    for (const file of mdFiles) {
      const path = join(dir, file);
      try {
        const content = await readFile(path, "utf-8");
        const firstLine =
          content
            .split("\n")
            .find((l) => l.trim())
            ?.trim()
            .replace(/^#+\s*/, "")
            .slice(0, 100) || "";
        rules.push({ name: basename(file, ".md"), path, firstLine, content });
      } catch {}
    }
    return rules;
  } catch {
    return [];
  }
}

/**
 * Discovers rules from global (~/.tentickle/rules/) and project-level
 * directories. Project rules override global rules with the same filename.
 *
 * Injection strategy is automatic:
 * - Small total content (<3000 chars): full rules inline as Grounding
 * - Large total content: index with paths, agent reads on demand
 */
export function Rules({ workspace }: { workspace: string }) {
  const [rules, setRules] = useState<RuleFile[]>([]);

  useOnMount(async () => {
    const global = await discoverRules(getGlobalRulesDir());
    const project = await discoverRules(getProjectRulesDir(workspace));

    // Project rules override global rules with the same filename
    const projectNames = new Set(project.map((r) => r.name));
    const merged = [...global.filter((r) => !projectNames.has(r.name)), ...project];

    if (merged.length > 0) setRules(merged);
  });

  if (rules.length === 0) return null;

  const totalChars = rules.reduce((sum, r) => sum + r.content.length, 0);

  if (totalChars <= INLINE_THRESHOLD) {
    return (
      <Grounding title="Rules">
        {rules.map((r) => `## ${r.name}\n\n${r.content.trim()}`).join("\n\n---\n\n")}
      </Grounding>
    );
  }

  return (
    <Grounding title="Rules">
      {`${rules.length} rule(s). Read with read_file when relevant.\n\n` +
        rules.map((r) => `- **${r.name}**: ${r.firstLine}\n  Path: ${r.path}`).join("\n")}
    </Grounding>
  );
}
