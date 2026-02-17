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

export function getClaudeMemoryDir(workspace: string): string {
  return join(homedir(), ".claude", "projects", workspaceSlug(workspace), "memory");
}

/** Skills directories — project-local and global */
export function getSkillsDirs(workspace: string): string[] {
  return [
    join(workspace, ".agents", "skills"), // project-local (shared convention)
    join(homedir(), ".tentickle", "skills"), // global
  ];
}
