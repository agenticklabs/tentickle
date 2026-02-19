import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { getDataDir } from "./paths.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface TentickleSettings {
  /** Which agent to use. Resolves to an agent file in the agents directory. */
  agent?: string;

  /** Model provider: "openai" | "google" | "apple". */
  provider?: string;

  /** Model name within the provider (e.g. "gpt-4o", "gemini-2.5-flash"). */
  model?: string;

  /** Provider-specific endpoint override. */
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function globalSettingsPath(): string {
  return join(getDataDir(), "settings.json");
}

function projectSettingsPath(workspace: string): string {
  return join(workspace, ".tentickle", "settings.json");
}

function projectLocalSettingsPath(workspace: string): string {
  return join(workspace, ".tentickle", "settings.local.json");
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadJsonSafe(path: string): Partial<TentickleSettings> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Load settings with layered override: global → project → project-local.
 * Later layers override earlier ones. Missing files are silently skipped.
 */
export function loadSettings(workspace: string): TentickleSettings {
  const global = loadJsonSafe(globalSettingsPath());
  const project = loadJsonSafe(projectSettingsPath(workspace));
  const local = loadJsonSafe(projectLocalSettingsPath(workspace));
  return { ...global, ...project, ...local };
}

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

function ensureGitignore(workspace: string, pattern: string): void {
  const gitignorePath = join(workspace, ".gitignore");
  try {
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    if (existing.includes(pattern)) return;
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(gitignorePath, `${separator}${pattern}\n`);
  } catch {
    // Can't write .gitignore — not fatal
  }
}

/**
 * Ensure the global data directory exists with the expected structure.
 * Called once at startup. Idempotent.
 */
export function scaffoldGlobalDataDir(): void {
  const dataDir = getDataDir();
  const dirs = [
    dataDir,
    join(dataDir, "projects"),
    join(dataDir, "skills"),
    join(dataDir, "profiles"),
    join(dataDir, "user"),
    join(dataDir, "entities"),
    join(dataDir, "rules"),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure the project-local .tentickle/ directory exists.
 * Lazily created — only call when you actually need to write project settings.
 * Auto-adds settings.local.json to .gitignore in git repos.
 */
export function scaffoldProjectDir(workspace: string): void {
  const projectTentickle = join(workspace, ".tentickle");
  mkdirSync(projectTentickle, { recursive: true });

  if (isGitRepo(workspace)) {
    ensureGitignore(workspace, ".tentickle/*.local.*");
  }
}

// ---------------------------------------------------------------------------
// Writers (for CLI init, settings commands, etc.)
// ---------------------------------------------------------------------------

export function writeGlobalSettings(settings: TentickleSettings): void {
  const path = globalSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

export function writeProjectSettings(workspace: string, settings: TentickleSettings): void {
  scaffoldProjectDir(workspace);
  writeFileSync(projectSettingsPath(workspace), JSON.stringify(settings, null, 2) + "\n");
}

export function writeProjectLocalSettings(workspace: string, settings: TentickleSettings): void {
  scaffoldProjectDir(workspace);
  writeFileSync(projectLocalSettingsPath(workspace), JSON.stringify(settings, null, 2) + "\n");
}
