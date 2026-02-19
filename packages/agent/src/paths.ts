import { homedir } from "node:os";
import { join } from "node:path";

/** Global tentickle data directory. */
export function getDataDir(): string {
  return join(homedir(), ".tentickle");
}

/** IDENTITY.md path. */
export function getIdentityPath(): string {
  return join(getDataDir(), "IDENTITY.md");
}

function workspaceSlug(workspace: string): string {
  return workspace.replaceAll("/", "-");
}

/** Per-project data directory. */
export function getProjectDir(workspace: string): string {
  return join(getDataDir(), "projects", workspaceSlug(workspace));
}

/** Per-project MEMORY.md path. */
export function getMemoryPath(workspace: string): string {
  return join(getProjectDir(workspace), "MEMORY.md");
}

/** Claude Code memory directory (read-only — we never write here). */
export function getClaudeMemoryDir(workspace: string): string {
  return join(homedir(), ".claude", "projects", workspaceSlug(workspace), "memory");
}

/** Owner profile directory — info the agent maintains about its human. */
export function getUserDir(): string {
  return join(getDataDir(), "user");
}

/** Entities directory — people, orgs, things the agent knows about. */
export function getEntitiesDir(): string {
  return join(getDataDir(), "entities");
}

/** Sandbox profiles directory. */
export function getProfilesDir(): string {
  return join(getDataDir(), "profiles");
}

/** Global rules directory. */
export function getGlobalRulesDir(): string {
  return join(getDataDir(), "rules");
}

/** Per-project rules directory. */
export function getProjectRulesDir(workspace: string): string {
  return join(getProjectDir(workspace), "rules");
}

/** Skills directories — project-local and global. */
export function getSkillsDirs(workspace: string): string[] {
  return [join(workspace, ".agents", "skills"), join(getDataDir(), "skills")];
}
