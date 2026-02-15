import { readdir, stat } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import type { CompletionSource, CompletionItem } from "@agentick/client";
import { SUPPORTED_EXTENSIONS, expandHome } from "./attach-file.js";

const ATTACH_PREFIX = "/attach ";

/**
 * Single completion source for file path navigation after `/attach `.
 *
 * match: activates when value starts with "/attach " and cursor is past it.
 * resolve: stats the resolved path, lists directory contents or filters.
 *
 * Directory drilling is emergent: accepting "packages/" makes value
 * "/attach packages/", match fires again with query="packages/",
 * resolve lists that directory's contents.
 */
export function createFileCompletionSource(): CompletionSource {
  return {
    id: "file-attach",
    match({ value, cursor }) {
      if (!value.startsWith(ATTACH_PREFIX) || cursor < ATTACH_PREFIX.length) return null;
      return { from: ATTACH_PREFIX.length, query: value.slice(ATTACH_PREFIX.length, cursor) };
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

      // Compute the path prefix for item values.
      // Each item's value is the FULL path from position `from` (after "/attach ").
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
          } else {
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
