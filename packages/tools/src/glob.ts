import { createTool, type ToolClass } from "@agentick/core";
import { useSandbox } from "@agentick/sandbox";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

async function walkAndMatch(
  dir: string,
  base: string,
  regex: RegExp,
  results: string[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath);

    if (entry.isDirectory()) {
      await walkAndMatch(fullPath, base, regex, results, maxResults);
    } else if (regex.test(relPath)) {
      results.push(relPath);
    }
  }
}

export const Glob: ToolClass = createTool({
  name: "glob",
  description: `Find files matching a glob pattern relative to the workspace.

When to use:
- Understanding project structure: \`**/*.ts\`, \`src/**/*.tsx\`
- Finding specific config files: \`**/tsconfig.json\`, \`**/*.test.ts\`
- Narrowing scope before grep — glob first to understand layout, then grep for content

Output: file paths (max 200), sorted alphabetically.
Skips node_modules and dotfiles automatically.
If you get 200 results, narrow your pattern or use the \`path\` param to target a subdirectory.`,
  displaySummary: (input) => input.pattern,
  input: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")'),
    path: z.string().optional().describe("Subdirectory to search in (relative to workspace)"),
  }),
  use: () => ({ sandbox: useSandbox() }),
  handler: async ({ pattern, path }, deps) => {
    const base = join(deps!.sandbox.workspacePath, path ?? "");
    const regex = globToRegex(pattern);
    const results: string[] = [];

    await walkAndMatch(base, base, regex, results, 200);
    results.sort();

    if (results.length === 0) {
      return [{ type: "text" as const, text: "No files found." }];
    }

    return [{ type: "text" as const, text: results.join("\n") }];
  },
});
