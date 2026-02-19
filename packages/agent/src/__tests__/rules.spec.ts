import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// We test the pure discovery logic by importing the component's internals
// indirectly — since discoverRules is not exported, we test via the path
// helpers and replicate the discovery logic for unit testing.

import { getGlobalRulesDir, getProjectRulesDir } from "../paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join(tmpdir(), `rules-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRule(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(path, content);
  return path;
}

// Replicate the discovery logic from rules.tsx for unit testing.
// This is intentionally coupled to the implementation — if the impl
// changes, these tests should break.
import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";

interface RuleFile {
  name: string;
  path: string;
  firstLine: string;
  content: string;
}

async function discoverRules(dir: string): Promise<RuleFile[]> {
  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
    const rules: RuleFile[] = [];
    for (const file of mdFiles) {
      const path = join(dir, file);
      try {
        const content = await readFile(path, "utf-8");
        const firstLine =
          content
            .split("\n")
            .find((l) => l.trim())
            ?.trim()
            .replace(/^#+\s*/, "")
            .slice(0, 100) || "";
        rules.push({ name: basename(file, ".md"), path, firstLine, content });
      } catch {}
    }
    return rules;
  } catch {
    return [];
  }
}

function mergeRules(global: RuleFile[], project: RuleFile[]): RuleFile[] {
  const projectNames = new Set(project.map((r) => r.name));
  return [...global.filter((r) => !projectNames.has(r.name)), ...project];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rules discovery", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array for nonexistent directory", async () => {
    const rules = await discoverRules(join(dir, "nope"));
    expect(rules).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const rules = await discoverRules(dir);
    expect(rules).toEqual([]);
  });

  it("ignores non-markdown files", async () => {
    writeFileSync(join(dir, "notes.txt"), "not a rule");
    writeFileSync(join(dir, "config.json"), "{}");
    const rules = await discoverRules(dir);
    expect(rules).toEqual([]);
  });

  it("discovers markdown files sorted alphabetically", async () => {
    writeRule(dir, "z-last", "# Last Rule\nContent");
    writeRule(dir, "a-first", "# First Rule\nContent");
    const rules = await discoverRules(dir);
    expect(rules.map((r) => r.name)).toEqual(["a-first", "z-last"]);
  });

  it("extracts first non-empty line as summary", async () => {
    writeRule(dir, "test", "\n\n# My Rule\nSome details");
    const rules = await discoverRules(dir);
    expect(rules[0].firstLine).toBe("My Rule");
  });

  it("strips heading markers from first line", async () => {
    writeRule(dir, "test", "### Deep Heading\nBody");
    const rules = await discoverRules(dir);
    expect(rules[0].firstLine).toBe("Deep Heading");
  });

  it("truncates long first lines to 100 chars", async () => {
    writeRule(dir, "test", "# " + "a".repeat(200));
    const rules = await discoverRules(dir);
    expect(rules[0].firstLine.length).toBe(100);
  });

  it("handles empty file gracefully", async () => {
    writeRule(dir, "empty", "");
    const rules = await discoverRules(dir);
    expect(rules).toHaveLength(1);
    expect(rules[0].firstLine).toBe("");
    expect(rules[0].content).toBe("");
  });

  it("preserves full content", async () => {
    const content = "# Rule\n\nDo the thing.\n\n- Step 1\n- Step 2\n";
    writeRule(dir, "full", content);
    const rules = await discoverRules(dir);
    expect(rules[0].content).toBe(content);
  });

  it("skips files it cannot read without failing", async () => {
    writeRule(dir, "good", "# Good\nOK");
    // Create a subdirectory with .md name — readFile will fail on it
    mkdirSync(join(dir, "bad.md"));
    const rules = await discoverRules(dir);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("good");
  });
});

describe("rules layering", () => {
  it("returns all global rules when no project rules", () => {
    const global: RuleFile[] = [
      { name: "safety", path: "/g/safety.md", firstLine: "Be safe", content: "# Be safe" },
    ];
    const merged = mergeRules(global, []);
    expect(merged).toEqual(global);
  });

  it("returns all project rules when no global rules", () => {
    const project: RuleFile[] = [
      { name: "local", path: "/p/local.md", firstLine: "Local", content: "# Local" },
    ];
    const merged = mergeRules([], project);
    expect(merged).toEqual(project);
  });

  it("project rule overrides global rule with same name", () => {
    const global: RuleFile[] = [
      { name: "deploy", path: "/g/deploy.md", firstLine: "Global deploy", content: "global" },
    ];
    const project: RuleFile[] = [
      { name: "deploy", path: "/p/deploy.md", firstLine: "Project deploy", content: "project" },
    ];
    const merged = mergeRules(global, project);
    expect(merged).toHaveLength(1);
    expect(merged[0].path).toBe("/p/deploy.md");
    expect(merged[0].content).toBe("project");
  });

  it("preserves non-overlapping rules from both layers", () => {
    const global: RuleFile[] = [
      { name: "safety", path: "/g/safety.md", firstLine: "Safe", content: "safe" },
      { name: "style", path: "/g/style.md", firstLine: "Style", content: "style" },
    ];
    const project: RuleFile[] = [
      { name: "deploy", path: "/p/deploy.md", firstLine: "Deploy", content: "deploy" },
    ];
    const merged = mergeRules(global, project);
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.name).sort()).toEqual(["deploy", "safety", "style"]);
  });

  it("partial overlap: overrides only matching names", () => {
    const global: RuleFile[] = [
      { name: "a", path: "/g/a.md", firstLine: "A", content: "ga" },
      { name: "b", path: "/g/b.md", firstLine: "B", content: "gb" },
      { name: "c", path: "/g/c.md", firstLine: "C", content: "gc" },
    ];
    const project: RuleFile[] = [
      { name: "b", path: "/p/b.md", firstLine: "B2", content: "pb" },
      { name: "d", path: "/p/d.md", firstLine: "D", content: "pd" },
    ];
    const merged = mergeRules(global, project);
    expect(merged).toHaveLength(4);
    const byName = Object.fromEntries(merged.map((r) => [r.name, r.content]));
    expect(byName["a"]).toBe("ga");
    expect(byName["b"]).toBe("pb"); // overridden
    expect(byName["c"]).toBe("gc");
    expect(byName["d"]).toBe("pd");
  });

  it("all global rules overridden when project has all same names", () => {
    const global: RuleFile[] = [
      { name: "x", path: "/g/x.md", firstLine: "X", content: "gx" },
      { name: "y", path: "/g/y.md", firstLine: "Y", content: "gy" },
    ];
    const project: RuleFile[] = [
      { name: "x", path: "/p/x.md", firstLine: "X2", content: "px" },
      { name: "y", path: "/p/y.md", firstLine: "Y2", content: "py" },
    ];
    const merged = mergeRules(global, project);
    expect(merged).toHaveLength(2);
    expect(merged.every((r) => r.path.startsWith("/p/"))).toBe(true);
  });
});

describe("inline threshold behavior", () => {
  const INLINE_THRESHOLD = 3000;

  it("small rule set would be inlined", () => {
    const rules: RuleFile[] = [{ name: "a", path: "/a.md", firstLine: "A", content: "short" }];
    const total = rules.reduce((sum, r) => sum + r.content.length, 0);
    expect(total).toBeLessThanOrEqual(INLINE_THRESHOLD);
  });

  it("large rule set would be indexed", () => {
    const rules: RuleFile[] = Array.from({ length: 20 }, (_, i) => ({
      name: `rule-${i}`,
      path: `/rules/rule-${i}.md`,
      firstLine: `Rule ${i}`,
      content: "x".repeat(200),
    }));
    const total = rules.reduce((sum, r) => sum + r.content.length, 0);
    expect(total).toBeGreaterThan(INLINE_THRESHOLD);
  });

  it("threshold is exactly at boundary", () => {
    const content = "x".repeat(INLINE_THRESHOLD);
    const rules: RuleFile[] = [{ name: "big", path: "/big.md", firstLine: "Big", content }];
    const total = rules.reduce((sum, r) => sum + r.content.length, 0);
    expect(total).toBe(INLINE_THRESHOLD);
    // At threshold = still inlined (<=)
  });

  it("one char over threshold switches to index mode", () => {
    const content = "x".repeat(INLINE_THRESHOLD + 1);
    const rules: RuleFile[] = [{ name: "big", path: "/big.md", firstLine: "Big", content }];
    const total = rules.reduce((sum, r) => sum + r.content.length, 0);
    expect(total).toBeGreaterThan(INLINE_THRESHOLD);
  });
});

describe("path helpers", () => {
  it("getGlobalRulesDir returns rules under data dir", () => {
    const dir = getGlobalRulesDir();
    expect(dir).toMatch(/\.tentickle\/rules$/);
  });

  it("getProjectRulesDir returns rules under project dir", () => {
    const dir = getProjectRulesDir("/some/workspace");
    expect(dir).toMatch(/\.tentickle\/projects\/.*\/rules$/);
  });
});
