import { useMemo } from "react";
import { System, Section, gate, useGate, useContinuation } from "@agentick/core";
import {
  TentickleAgent,
  useTentickle,
  createSpawnTool,
  createExploreTool,
  getMemoryPath,
} from "@tentickle/agent";
import { getSchedulerStore, createScheduleTool } from "@agentick/scheduler";

// ---------------------------------------------------------------------------
// Gate: verification — ensure model verifies edits before completing
// ---------------------------------------------------------------------------

const verificationGate = gate({
  description: "Verify your changes before completing",
  instructions: `VERIFICATION PENDING: You've modified files. Review your project memory for verification procedures. Run appropriate checks via shell (typecheck, tests, lint). Clear the verification gate when satisfied. Set to "deferred" if you plan to verify after completing other work.`,
  activateWhen: (result) =>
    result.toolCalls.some((tc) => ["write_file", "edit_file"].includes(tc.name)),
});

// ---------------------------------------------------------------------------
// SpawnTool / ExploreTool — self-referencing, must be hoisted
// ---------------------------------------------------------------------------

const SpawnTool = createSpawnTool(CodingAgent);
const ExploreTool = createExploreTool(CodingAgent);

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export type CodingAgentProps = {
  workspace?: string;
};

export function CodingAgent({ workspace = process.cwd() }: CodingAgentProps) {
  const memoryFile = getMemoryPath(workspace);

  // Shared cron store — bound globally in main.ts, shared across sessions
  const cronStore = getSchedulerStore();
  const ScheduleTool = useMemo(
    () => (cronStore ? createScheduleTool(cronStore) : null),
    [cronStore],
  );

  return (
    <TentickleAgent workspace={workspace}>
      <CodingBehavior workspace={workspace} memoryFile={memoryFile} />
      <SpawnTool />
      <ExploreTool />
      {ScheduleTool && <ScheduleTool />}
    </TentickleAgent>
  );
}

/**
 * Coding-specific behavior: system prompt, conventions, gate, continuation.
 * Separated into a child component so it can call useTentickle().
 */
function CodingBehavior({ workspace, memoryFile }: { workspace: string; memoryFile: string }) {
  const { taskStore } = useTentickle();
  const verification = useGate("verification", verificationGate);

  useContinuation((result) => {
    if (result.tick >= 50) return false;
    const tasks = taskStore.list();
    if (tasks.length > 0 && taskStore.hasIncomplete()) return true;
  });

  return (
    <>
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

      {verification.element}
    </>
  );
}
