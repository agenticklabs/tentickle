import { useState } from "react";
import { Grounding, useOnMount } from "@agentick/core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkillsDirs } from "./paths.js";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

function discoverSkills(workspace: string): SkillInfo[] {
  const dirs = getSkillsDirs(workspace);
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillPath = join(dir, entry, "SKILL.md");
      if (!existsSync(skillPath)) continue;

      try {
        const raw = readFileSync(skillPath, "utf-8");
        const match = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!match) continue;
        const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() || entry;
        const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
        if (seen.has(name)) continue;
        seen.add(name);
        skills.push({ name, description, path: skillPath });
      } catch {}
    }
  }

  return skills;
}

/**
 * Discovers installed SKILL.md files and renders a lightweight index.
 * The agent reads the full skill with read_file when needed.
 */
export function Skills({ workspace }: { workspace: string }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useOnMount(() => {
    setSkills(discoverSkills(workspace));
  });

  if (skills.length === 0) return null;

  return (
    <Grounding title="Available Skills">
      {`${skills.length} skill(s) installed. Read the full SKILL.md with read_file when needed.\n\n` +
        skills.map((s) => `- **${s.name}**: ${s.description}\n  Path: ${s.path}`).join("\n")}
    </Grounding>
  );
}
