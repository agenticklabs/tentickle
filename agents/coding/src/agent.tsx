import { useState, useEffect, useMemo } from "react";
import {
  System,
  Section,
  Grounding,
  Knobs,
  createTool,
  useOnMount,
  useOnTickEnd,
} from "@agentick/core";
import { Sandbox, SandboxTools, useSandbox } from "@agentick/sandbox";
import { localProvider } from "@agentick/sandbox-local";
import { Glob, Grep } from "@tentickle/tools";
import { useContinuation } from "@agentick/core";
import { z } from "zod";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { mkdirSync, existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { DynamicModel } from "./model.js";
import { createTaskTool } from "./tools/task-list.js";
import { createSpawnTool } from "./tools/spawn.js";
import { EnhancedTimeline } from "./components/timeline.js";
import { getMemoryDir, getMemoryPath, getClaudeMemoryDir, getSkillsDirs } from "./memory-path.js";
import { TaskStore, bindTaskStore } from "./task-store.js";

const SpawnTool = createSpawnTool(CodingAgent);

const AddDirCommand = createTool({
  name: "add-dir",
  description: "Mount a directory into the sandbox",
  input: z.object({ path: z.string().describe("Directory path to mount") }),
  audience: "user",
  aliases: ["mount"],
  use() {
    return { sandbox: useSandbox() };
  },
  handler: async ({ path: dirPath }, deps) => {
    const resolved = resolve(dirPath.trim());
    await deps!.sandbox.addMount({ host: resolved, sandbox: resolved, mode: "rw" });
    return [{ type: "text" as const, text: `Mounted: ${resolved}` }];
  },
});

function TaskStoreBridge({ store }: { store: TaskStore }) {
  useEffect(() => {
    bindTaskStore(store);
  }, [store]);
  return null;
}

// ---------------------------------------------------------------------------
// Grounding: workspace info (package.json, git branch, scripts)
// ---------------------------------------------------------------------------

function WorkspaceGrounding({ workspace }: { workspace: string }) {
  const [info, setInfo] = useState<string | null>(null);

  useOnMount(async () => {
    const lines: string[] = [`Workspace: ${workspace}`];

    try {
      const raw = await readFile(join(workspace, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.name) lines.push(`Project: ${pkg.name}`);
      if (pkg.scripts) {
        const cmds = Object.entries(pkg.scripts)
          .filter(([k]) => ["build", "test", "typecheck", "lint", "dev", "start"].includes(k))
          .map(([k, v]) => `  ${k}: ${v}`);
        if (cmds.length > 0) lines.push("Scripts:", ...cmds);
      }
    } catch {}

    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspace,
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      lines.push(`Git branch: ${branch}`);
    } catch {}

    setInfo(lines.join("\n"));
  });

  if (!info) return null;
  return <Grounding title="Workspace">{info}</Grounding>;
}

// ---------------------------------------------------------------------------
// Grounding: CLAUDE.md / AGENTS.md injection
// ---------------------------------------------------------------------------

function ProjectConventions({ workspace }: { workspace: string }) {
  const [content, setContent] = useState<string | null>(null);

  useOnMount(async () => {
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      const path = join(workspace, name);
      if (!existsSync(path)) continue;
      try {
        const text = await readFile(path, "utf-8");
        if (text.trim()) {
          setContent(text);
          return;
        }
      } catch {}
    }
  });

  if (!content) return null;
  return <Grounding title="Project Conventions">{content}</Grounding>;
}

// ---------------------------------------------------------------------------
// Grounding: Claude Code memory (read-only, never write)
// ---------------------------------------------------------------------------

function fileAge(filePath: string): string | null {
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

function ClaudeMemory({ workspace }: { workspace: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);

  useOnMount(async () => {
    const dir = getClaudeMemoryDir(workspace);
    const memoryPath = join(dir, "MEMORY.md");
    try {
      const text = await readFile(memoryPath, "utf-8");
      if (text.trim()) {
        setContent(text);
        setAge(fileAge(memoryPath));
      }
    } catch {}
  });

  if (!content) return null;
  const title = age
    ? `Claude Code Memory (read-only, updated ${age})`
    : "Claude Code Memory (read-only)";
  return <Grounding title={title}>{content}</Grounding>;
}

// ---------------------------------------------------------------------------
// Skills: installed SKILL.md index (lightweight — read full skill on demand)
// ---------------------------------------------------------------------------

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

function discoverSkills(workspace: string): SkillInfo[] {
  const dirs = getSkillsDirs(workspace);
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillPath = join(dir, entry, "SKILL.md");
      if (!existsSync(skillPath)) continue;

      try {
        const raw = readFileSync(skillPath, "utf-8");
        const match = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!match) continue;
        const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() || entry;
        const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
        if (seen.has(name)) continue;
        seen.add(name);
        skills.push({ name, description, path: skillPath });
      } catch {}
    }
  }

  return skills;
}

function Skills({ workspace }: { workspace: string }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useOnMount(() => {
    setSkills(discoverSkills(workspace));
  });

  if (skills.length === 0) return null;

  return (
    <Grounding title="Available Skills">
      {`${skills.length} skill(s) installed. Read the full SKILL.md with read_file when needed.\n\n` +
        skills.map((s) => `- **${s.name}**: ${s.description}\n  Path: ${s.path}`).join("\n")}
    </Grounding>
  );
}

// ---------------------------------------------------------------------------
// Memory: reactive — re-reads after each tick
// ---------------------------------------------------------------------------

function Memory({ workspace }: { workspace: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useOnTickEnd(() => setVersion((v) => v + 1));

  useEffect(() => {
    const path = getMemoryPath(workspace);
    readFile(path, "utf-8")
      .then((text) => {
        setContent(text);
        setAge(fileAge(path));
      })
      .catch(() => {
        setContent(null);
        setAge(null);
      });
  }, [workspace, version]);

  if (!content) return null;
  const title = age ? `Project Memory (updated ${age})` : "Project Memory";
  return (
    <Section id="memory" title={title}>
      {content}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export type CodingAgentProps = {
  workspace?: string;
};

export function CodingAgent({ workspace = process.cwd() }: CodingAgentProps) {
  const memoryDir = getMemoryDir(workspace);
  const memoryFile = getMemoryPath(workspace);
  mkdirSync(memoryDir, { recursive: true });

  // Skills directories (read-only mounts)
  const skillsDirs = getSkillsDirs(workspace);
  const skillsMounts = skillsDirs
    .filter((d) => existsSync(d))
    .map((d) => ({ host: d, sandbox: d, mode: "ro" as const }));

  // Per-instance task store — each spawned agent gets its own
  const [taskStore] = useState(() => new TaskStore());
  const TaskTool = useMemo(() => createTaskTool(taskStore), [taskStore]);

  useContinuation((result) => {
    if (result.tick >= 50) return false;
    const tasks = taskStore.list();
    if (tasks.length > 0 && taskStore.hasIncomplete()) return true;
  });

  return (
    <Sandbox
      provider={localProvider()}
      workspace={workspace}
      mounts={[{ host: memoryDir, sandbox: memoryDir, mode: "rw" }, ...skillsMounts]}
    >
      <AddDirCommand />
      <TaskStoreBridge store={taskStore} />
      <DynamicModel />

      <System>
        You are a coding agent working in: `{workspace}`<h2>RULES:</h2>
        <ul>
          <li>ACT, don't narrate. Never say "I'll read the file" — just call read_file.</li>
          <li>Never describe what you plan to do without doing it in the same response.</li>
          <li>Use tools in EVERY response. If you have nothing to do, say so. Otherwise, act.</li>
          <li>Text output is for the user: brief status, results, decisions. Not plans.</li>
          <li>Read before editing. Verify changes with shell.</li>
          <li>If something fails, diagnose the root cause — don't retry blindly.</li>
        </ul>
      </System>

      <Section id="conventions" title="Conventions">
        <ul>
          <li>For non-trivial work, use `task_list` with action `plan` first.</li>
          <li>Verify every change: run tests, typecheck, or at minimum `shell` to confirm.</li>
          <li>Prefer `edit_file` over `write_file` for existing files.</li>
          <li>Use `spawn` for independent sub-tasks — the sub-agent has full workspace access.</li>
          <li>When you discover project structure, write it to `{memoryFile}`.</li>
          <li>If "Project Memory" appears below, you already know this project.</li>
          <li>
            If not, orient immediately: glob structure, read key files, then write findings to `
            {memoryFile}`.
          </li>
          <li>
            Historical messages show `[ref:N]` summaries. Use `set_knob(name="ref:N", value=true)`
            to expand any compacted message and see its full original content. Expansions reset
            after each execution.
          </li>
        </ul>
      </Section>

      <WorkspaceGrounding workspace={workspace} />
      <ProjectConventions workspace={workspace} />
      <ClaudeMemory workspace={workspace} />
      <Skills workspace={workspace} />
      <Memory workspace={workspace} />

      <EnhancedTimeline />

      <Knobs />
      <SandboxTools />
      <Glob />
      <Grep />
      <TaskTool />
      <SpawnTool />
    </Sandbox>
  );
}
