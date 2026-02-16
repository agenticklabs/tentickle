import { readdir, stat } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import type { CompletionSource, CompletionItem } from "@agentick/client";
import { SUPPORTED_EXTENSIONS, expandHome } from "./attach-file.js";

/**
 * Create a path completion source for a slash command.
 *
 * @param prefix - The command prefix including trailing space (e.g. "/attach ")
 * @param mode - "files" shows files + directories, "dirs" shows directories only
 */
function createPathCompletionSource(
  id: string,
  prefix: string,
  mode: "files" | "dirs",
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
            items.push({
              label: entry.name + "/",
              value: `${pathPrefix}${entry.name}/`,
              description: "dir",
              continues: true,
            });
          } else if (mode === "files") {
            const ext = extname(entry.name).toLowerCase();
            if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
            items.push({
              label: entry.name,
              value: `${pathPrefix}${entry.name}`,
              description: ext.slice(1),
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
