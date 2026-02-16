import { homedir } from "node:os";
import { join } from "node:path";

function workspaceSlug(workspace: string): string {
  return workspace.replaceAll("/", "-");
}

export function getMemoryDir(workspace: string): string {
  return join(homedir(), ".tentickle", "projects", workspaceSlug(workspace));
}

export function getMemoryPath(workspace: string): string {
  return join(getMemoryDir(workspace), "MEMORY.md");
}
