import { statSync } from "node:fs";

export function fileAge(filePath: string): string | null {
  try {
    const ms = Date.now() - statSync(filePath).mtimeMs;
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return null;
  }
}
