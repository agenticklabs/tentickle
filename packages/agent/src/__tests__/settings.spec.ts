import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSettings,
  scaffoldGlobalDataDir,
  scaffoldProjectDir,
  writeProjectSettings,
  writeProjectLocalSettings,
} from "../settings.js";

// We can't easily mock homedir() in the settings module, so we test the
// pure functions that accept paths directly. For scaffoldGlobalDataDir we
// test it creates the real dirs (idempotent, safe).

const TEST_DIR = join(tmpdir(), `tentickle-settings-test-${process.pid}`);
const WORKSPACE = join(TEST_DIR, "workspace");

beforeEach(() => {
  mkdirSync(WORKSPACE, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ===========================================================================
// loadSettings — layered override
// ===========================================================================

describe("loadSettings", () => {
  it("returns empty object when no settings files exist", () => {
    const settings = loadSettings(WORKSPACE);
    // No global, no project, no local → empty (or whatever global defaults exist)
    expect(settings).toBeDefined();
    expect(typeof settings).toBe("object");
  });

  it("loads project settings", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "settings.json"),
      JSON.stringify({ agent: "coding", model: "gpt-4o" }),
    );
    const settings = loadSettings(WORKSPACE);
    expect(settings.agent).toBe("coding");
    expect(settings.model).toBe("gpt-4o");
  });

  it("project-local overrides project settings", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "settings.json"),
      JSON.stringify({ agent: "coding", model: "gpt-4o" }),
    );
    writeFileSync(
      join(projectDir, "settings.local.json"),
      JSON.stringify({ model: "gemini-2.5-flash" }),
    );
    const settings = loadSettings(WORKSPACE);
    expect(settings.agent).toBe("coding"); // from project
    expect(settings.model).toBe("gemini-2.5-flash"); // overridden by local
  });

  it("survives malformed JSON gracefully", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "settings.json"), "NOT JSON {{{");
    expect(() => loadSettings(WORKSPACE)).not.toThrow();
    const settings = loadSettings(WORKSPACE);
    expect(settings).toBeDefined();
  });

  it("survives empty file gracefully", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "settings.json"), "");
    expect(() => loadSettings(WORKSPACE)).not.toThrow();
  });
});

// ===========================================================================
// scaffoldProjectDir
// ===========================================================================

describe("scaffoldProjectDir", () => {
  it("creates .tentickle/ directory", () => {
    scaffoldProjectDir(WORKSPACE);
    expect(existsSync(join(WORKSPACE, ".tentickle"))).toBe(true);
  });

  it("is idempotent", () => {
    scaffoldProjectDir(WORKSPACE);
    scaffoldProjectDir(WORKSPACE);
    expect(existsSync(join(WORKSPACE, ".tentickle"))).toBe(true);
  });

  it("adds gitignore pattern in git repos", () => {
    // Init a git repo so isGitRepo returns true
    const { execSync } = require("node:child_process");
    execSync("git init", { cwd: WORKSPACE, stdio: "pipe" });

    scaffoldProjectDir(WORKSPACE);

    const gitignore = readFileSync(join(WORKSPACE, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".tentickle/*.local.*");
  });

  it("does not duplicate gitignore entry on repeated calls", () => {
    const { execSync } = require("node:child_process");
    execSync("git init", { cwd: WORKSPACE, stdio: "pipe" });

    scaffoldProjectDir(WORKSPACE);
    scaffoldProjectDir(WORKSPACE);
    scaffoldProjectDir(WORKSPACE);

    const gitignore = readFileSync(join(WORKSPACE, ".gitignore"), "utf-8");
    const matches = gitignore.match(/\.tentickle\/\*\.local\.\*/g);
    expect(matches).toHaveLength(1);
  });

  it("appends to existing gitignore without corrupting", () => {
    const { execSync } = require("node:child_process");
    execSync("git init", { cwd: WORKSPACE, stdio: "pipe" });

    // Pre-existing gitignore without trailing newline
    writeFileSync(join(WORKSPACE, ".gitignore"), "node_modules/\n.env");

    scaffoldProjectDir(WORKSPACE);

    const gitignore = readFileSync(join(WORKSPACE, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".tentickle/*.local.*");
    // Should have added a newline separator before the pattern
    expect(gitignore).not.toContain(".env.tentickle"); // not smashed together
  });

  it("does not add gitignore in non-git directories", () => {
    scaffoldProjectDir(WORKSPACE);
    expect(existsSync(join(WORKSPACE, ".gitignore"))).toBe(false);
  });
});

// ===========================================================================
// scaffoldGlobalDataDir
// ===========================================================================

describe("scaffoldGlobalDataDir", () => {
  it("creates expected subdirectories", () => {
    // This creates real dirs in ~/.tentickle/ — but they should already exist
    // in a dev environment, so it's idempotent and safe.
    scaffoldGlobalDataDir();

    const os = require("node:os");
    const path = require("node:path");
    const dataDir = path.join(os.homedir(), ".tentickle");
    expect(existsSync(dataDir)).toBe(true);
    expect(existsSync(path.join(dataDir, "projects"))).toBe(true);
    expect(existsSync(path.join(dataDir, "skills"))).toBe(true);
    expect(existsSync(path.join(dataDir, "profiles"))).toBe(true);
    expect(existsSync(path.join(dataDir, "user"))).toBe(true);
    expect(existsSync(path.join(dataDir, "entities"))).toBe(true);
  });

  it("is idempotent", () => {
    scaffoldGlobalDataDir();
    scaffoldGlobalDataDir();
    // No throw
  });
});

// ===========================================================================
// Writer functions
// ===========================================================================

describe("writeProjectSettings", () => {
  it("creates .tentickle/ and writes settings", () => {
    writeProjectSettings(WORKSPACE, { agent: "coding", model: "gpt-4o" });
    const raw = readFileSync(join(WORKSPACE, ".tentickle", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.agent).toBe("coding");
    expect(parsed.model).toBe("gpt-4o");
  });

  it("overwrites existing settings", () => {
    writeProjectSettings(WORKSPACE, { agent: "coding" });
    writeProjectSettings(WORKSPACE, { agent: "research" });
    const raw = readFileSync(join(WORKSPACE, ".tentickle", "settings.json"), "utf-8");
    expect(JSON.parse(raw).agent).toBe("research");
  });
});

describe("writeProjectLocalSettings", () => {
  it("creates .tentickle/ and writes local settings", () => {
    writeProjectLocalSettings(WORKSPACE, { baseUrl: "http://localhost:11434" });
    const raw = readFileSync(join(WORKSPACE, ".tentickle", "settings.local.json"), "utf-8");
    expect(JSON.parse(raw).baseUrl).toBe("http://localhost:11434");
  });
});

// ===========================================================================
// Adversarial: layering edge cases
// ===========================================================================

describe("settings layering edge cases", () => {
  it("undefined values in later layers do not clobber earlier ones", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "settings.json"),
      JSON.stringify({ agent: "coding", model: "gpt-4o" }),
    );
    // Local file has only provider — should not remove agent or model
    writeFileSync(join(projectDir, "settings.local.json"), JSON.stringify({ provider: "openai" }));
    const settings = loadSettings(WORKSPACE);
    expect(settings.agent).toBe("coding");
    expect(settings.model).toBe("gpt-4o");
    expect(settings.provider).toBe("openai");
  });

  it("null values in later layers DO override", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "settings.json"),
      JSON.stringify({ agent: "coding", model: "gpt-4o" }),
    );
    writeFileSync(
      join(projectDir, "settings.local.json"),
      // Explicit null should override via spread
      JSON.stringify({ model: null }),
    );
    const settings = loadSettings(WORKSPACE);
    expect(settings.model).toBeNull();
  });

  it("extra unknown keys are preserved (forward compat)", () => {
    const projectDir = join(WORKSPACE, ".tentickle");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "settings.json"),
      JSON.stringify({ agent: "coding", futureKey: "value" }),
    );
    const settings = loadSettings(WORKSPACE) as any;
    expect(settings.futureKey).toBe("value");
  });
});
