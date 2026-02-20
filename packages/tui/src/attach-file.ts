import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import type { Attachment, AttachmentInput } from "@agentick/client";

export const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);

/** Expand `~` or `~/` prefix to the user's home directory. */
export function expandHome(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return resolve(homedir(), filePath.slice(2));
  return filePath;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

type AttachResult = { ok: true; attachment: Attachment } | { ok: false; reason: string };

export async function attachFile(
  filePath: string,
  addAttachment: (input: AttachmentInput) => Attachment,
): Promise<AttachResult> {
  // Strip surrounding quotes — Finder drag-and-drop wraps paths in single quotes
  const stripped = filePath.replace(/^['"]|['"]$/g, "");
  const resolved = resolve(expandHome(stripped));
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_TYPES[ext];

  if (!mimeType) {
    const supported = Object.keys(MIME_TYPES).join(", ");
    return { ok: false, reason: `Unsupported file type "${ext}". Supported: ${supported}` };
  }

  try {
    const data = await readFile(resolved);
    const attachment = addAttachment({
      name: basename(resolved),
      mimeType,
      source: data.toString("base64"),
      size: data.byteLength,
    });
    return { ok: true, attachment };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }
}
