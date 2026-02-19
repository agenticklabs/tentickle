import { useState } from "react";
import { Grounding, useOnMount } from "@agentick/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Workspace awareness — package.json name, scripts, git branch.
 * Ephemeral grounding that orients the agent to the project.
 */
export function WorkspaceGrounding({ workspace }: { workspace: string }) {
  const [info, setInfo] = useState<string | null>(null);

  useOnMount(async () => {
    const lines: string[] = [`Workspace: ${workspace}`];

    try {
      const raw = await readFile(join(workspace, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.name) lines.push(`Project: ${pkg.name}`);
      if (pkg.scripts) {
        const cmds = Object.entries(pkg.scripts)
          .filter(([k]) => ["build", "test", "typecheck", "lint", "dev", "start"].includes(k))
          .map(([k, v]) => `  ${k}: ${v}`);
        if (cmds.length > 0) lines.push("Scripts:", ...cmds);
      }
    } catch {}

    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspace,
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      lines.push(`Git branch: ${branch}`);
    } catch {}

    setInfo(lines.join("\n"));
  });

  if (!info) return null;
  return <Grounding title="Workspace">{info}</Grounding>;
}

/**
 * Reads CLAUDE.md or AGENTS.md from the workspace root.
 * Project conventions authored by the human, read-only.
 */
export function ProjectConventions({ workspace }: { workspace: string }) {
  const [content, setContent] = useState<string | null>(null);

  useOnMount(async () => {
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      const path = join(workspace, name);
      if (!existsSync(path)) continue;
      try {
        const text = await readFile(path, "utf-8");
        if (text.trim()) {
          setContent(text);
          return;
        }
      } catch {}
    }
  });

  if (!content) return null;
  return <Grounding title="Project Conventions">{content}</Grounding>;
}
