import { useState, useEffect, useMemo } from "react";
import { System, Section, Timeline } from "@agentick/core";
import { Sandbox, SandboxTools, useSandbox } from "@agentick/sandbox";
import { localProvider } from "@agentick/sandbox-local";
import { Glob, Grep } from "@tentickle/tools";
import { useContinuation } from "@agentick/core";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { DynamicModel } from "./model.js";
import { createTaskTool } from "./tools/task-list.js";
import { createSpawnTool } from "./tools/spawn.js";
import { createExploreTool } from "./tools/explore.js";
import { getMemoryDir, getMemoryPath } from "./memory-path.js";
import { bindSandbox } from "./sandbox-ref.js";
import { TaskStore, bindTaskStore } from "./task-store.js";

const SpawnTool = createSpawnTool(CodingAgent);
const ExploreTool = createExploreTool(CodingAgent);

function SandboxBridge() {
  const sandbox = useSandbox();
  useEffect(() => {
    bindSandbox(sandbox);
  }, [sandbox]);
  return null;
}

function TaskStoreBridge({ store }: { store: TaskStore }) {
  useEffect(() => {
    bindTaskStore(store);
  }, [store]);
  return null;
}

function Memory() {
  const sandbox = useSandbox();
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    const path = getMemoryPath(sandbox.workspacePath);
    readFile(path, "utf-8")
      .then(setContent)
      .catch(() => setContent(null));
  }, [sandbox]);

  if (!content) return null;
  return (
    <Section id="memory" title="Project Memory">
      {content}
    </Section>
  );
}

export type CodingAgentProps = {
  workspace?: string;
};

export function CodingAgent({ workspace = process.cwd() }: CodingAgentProps) {
  const memoryDir = getMemoryDir(workspace);
  const memoryFile = `${memoryDir}/MEMORY.md`;
  mkdirSync(memoryDir, { recursive: true });

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
      mounts={[{ host: memoryDir, sandbox: memoryDir, mode: "rw" }]}
    >
      <SandboxBridge />
      <TaskStoreBridge store={taskStore} />
      <DynamicModel />
      <System>
        You are a coding agent working in: {workspace}
        Default to action. When you can find out by reading, don't ask. When you can solve by doing,
        don't discuss. Use your tools — `glob`, `grep`, `read_file`, `shell` — to answer your own
        questions. Write files with `write_file` and `edit_file`, not as text in your response. Your
        text output is for the user: brief status, results, decisions. Be proactive. Explore the
        codebase before being told to. Document what you discover in `{memoryFile}` so you remember
        it next time. If "Project Memory" appears below, you already know this project. If not,
        orient immediately: `glob` the structure, read key files (`package.json`, `README.md`,
        `CLAUDE.md`, `AGENTS.md`), then `write_file` to `{memoryFile}` with what you learned. Keep
        your memory current as you work: language, package manager, build/test commands, project
        structure, conventions. Read before editing. Verify changes with `shell`. If something
        fails, diagnose the root cause — don't retry blindly. For non-trivial work, use `task_list`
        with action `plan` to break work into steps, then `start`/`complete` each task as you go.
        Execution continues automatically while tasks are incomplete. Use `spawn` to delegate
        independent sub-tasks to a sub-agent. The sub-agent has full workspace access and reports
        back when done. Call `spawn` multiple times for concurrent work.
      </System>
      <Memory />
      <Timeline />
      <SandboxTools />
      <Glob />
      <Grep />
      <TaskTool />
      <SpawnTool />
      <ExploreTool />
    </Sandbox>
  );
}
