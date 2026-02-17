import { readdir, stat } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import type { CompletionSource, CompletionItem } from "@agentick/client";
import { SUPPORTED_EXTENSIONS, expandHome } from "./attach-file.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

/**
 * Create a path completion source for a slash command.
 *
 * @param prefix - The command prefix including trailing space (e.g. "/attach ")
 * @param mode - "files" shows files + directories, "dirs" shows directories only, "all" shows everything
 */
function createPathCompletionSource(
  id: string,
  prefix: string,
  mode: "files" | "dirs" | "all",
): CompletionSource {
  return {
    id,
    match({ value, cursor }) {
      if (!value.startsWith(prefix) || cursor < prefix.length) return null;
      return { from: prefix.length, query: value.slice(prefix.length, cursor) };
    },
    debounce: 80,
    async resolve({ query }) {
      const rawPath = query.replace(/^['"]|['"]$/g, "");
      const resolved = resolve(expandHome(rawPath) || ".");

      let dir: string;
      let filter: string;

      try {
        if ((await stat(resolved)).isDirectory()) {
          dir = resolved;
          filter = "";
        } else {
          dir = dirname(resolved);
          filter = basename(resolved).toLowerCase();
        }
      } catch {
        dir = dirname(resolved);
        filter = basename(resolved).toLowerCase();
      }

      let pathPrefix: string;
      if (filter === "") {
        pathPrefix = rawPath ? (rawPath.endsWith("/") ? rawPath : rawPath + "/") : "";
      } else {
        const lastSlash = rawPath.lastIndexOf("/");
        pathPrefix = lastSlash >= 0 ? rawPath.slice(0, lastSlash + 1) : "";
      }

      try {
        const entries = await readdir(dir, { withFileTypes: true });
        const items: CompletionItem[] = [];

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          if (filter && !entry.name.toLowerCase().startsWith(filter)) continue;

          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            items.push({
              label: entry.name + "/",
              value: `${pathPrefix}${entry.name}/`,
              description: "dir",
              continues: true,
            });
          } else if (mode === "all" || mode === "files") {
            const ext = extname(entry.name).toLowerCase();
            if (mode === "files" && !SUPPORTED_EXTENSIONS.has(ext)) continue;
            items.push({
              label: entry.name,
              value: `${pathPrefix}${entry.name}`,
              description: ext.slice(1) || "file",
            });
          }
        }

        items.sort((a, b) => {
          const aDir = a.description === "dir" ? 0 : 1;
          const bDir = b.description === "dir" ? 0 : 1;
          if (aDir !== bDir) return aDir - bDir;
          return a.label.localeCompare(b.label);
        });

        return items;
      } catch {
        return [];
      }
    },
  };
}

export function createFileCompletionSource(): CompletionSource {
  return createPathCompletionSource("file-attach", "/attach ", "files");
}

export function createDirCompletionSource(): CompletionSource {
  return createPathCompletionSource("dir-add", "/add-dir ", "dirs");
}

/**
 * Completion source triggered by `@` — shows all files (not just media).
 * Works mid-text: `fix the imports in @src/ag` → completes file paths.
 */
export function createMentionCompletionSource(): CompletionSource {
  const inner = createPathCompletionSource("mention", "@", "all");
  return {
    id: "mention",
    match({ value, cursor }) {
      // Walk backward from cursor to find the nearest `@` not preceded by a word char
      let i = cursor - 1;
      while (i >= 0 && value[i] !== "@" && value[i] !== " " && value[i] !== "\n") i--;
      if (i < 0 || value[i] !== "@") return null;
      // `@` must be at start or preceded by whitespace
      if (i > 0 && !/\s/.test(value[i - 1]!)) return null;
      const query = value.slice(i + 1, cursor);
      return { from: i + 1, query };
    },
    debounce: inner.debounce,
    resolve: inner.resolve,
  };
}
