import { createTool } from "@agentick/core";
import { useSandbox } from "@agentick/sandbox";
import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".pdf",
  ".doc",
  ".docx",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".lock",
]);

function simpleGlobToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*");
  return new RegExp(`^${escaped}$`);
}

async function searchDir(
  dir: string,
  base: string,
  pattern: RegExp,
  fileFilter: RegExp | null,
  matches: GrepMatch[],
  maxMatches: number,
): Promise<void> {
  if (matches.length >= maxMatches) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= maxMatches) return;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath);

    if (entry.isDirectory()) {
      await searchDir(fullPath, base, pattern, fileFilter, matches, maxMatches);
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (SKIP_EXTENSIONS.has(ext)) continue;
      if (fileFilter && !fileFilter.test(relPath)) continue;

      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxMatches) return;
          if (pattern.test(lines[i]!)) {
            matches.push({ file: relPath, line: i + 1, text: lines[i]! });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export const Grep = createTool({
  name: "grep",
  description:
    "Search file contents for a regex pattern. Returns matching lines with file paths and line numbers. Skips binary files, node_modules, and dotfiles.",
  displaySummary: (input) => input.pattern,
  input: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("Subdirectory to search in (relative to workspace)"),
    include: z.string().optional().describe('File glob to filter (e.g. "**/*.ts")'),
    caseSensitive: z
      .boolean()
      .optional()
      .default(true)
      .describe("Case-sensitive search (default: true)"),
  }),
  use: () => ({ sandbox: useSandbox() }),
  handler: async ({ pattern, path, include, caseSensitive }, deps) => {
    const base = join(deps!.sandbox.workspacePath, path ?? "");
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(pattern, flags);
    const fileFilter = include ? simpleGlobToRegex(include) : null;
    const matches: GrepMatch[] = [];

    await searchDir(base, base, regex, fileFilter, matches, 100);

    if (matches.length === 0) {
      return [{ type: "text" as const, text: "No matches found." }];
    }

    const output = matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");

    return [
      {
        type: "text" as const,
        text: matches.length >= 100 ? `${output}\n\n(truncated at 100 matches)` : output,
      },
    ];
  },
});
