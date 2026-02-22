import React, { useMemo } from "react";
import { System, Section, Context, gate, useGate, useContinuation } from "@agentick/core";
import {
  TentickleAgent,
  useTentickle,
  createSpawnTool,
  createExploreTool,
  createDelegateTool,
  createInspectJobTool,
  createApproveJobTool,
  createCancelJobTool,
  createSendToDelegateTool,
  createInspectDelegateTool,
  createCompleteDelegationTool,
  createEscalateTool,
  createRunVerificationTool,
  getDelegationMetadata,
  DelegateContext,
  SupervisorContext,
  ActiveJobs,
  getSessionStore,
  getApp,
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
  const sessionId = Context.tryGet()?.sessionId;
  const delegation = getDelegationMetadata(sessionId);

  if (delegation?.role === "supervisor") {
    return (
      <TentickleAgent workspace={workspace}>
        <SupervisorMode delegation={delegation} />
      </TentickleAgent>
    );
  }

  if (delegation?.role === "delegate") {
    return (
      <TentickleAgent workspace={workspace}>
        <DelegateMode delegation={delegation} workspace={workspace} />
        <SpawnTool />
        <ExploreTool />
      </TentickleAgent>
    );
  }

  // Normal mode — full agent with delegation tools
  return (
    <TentickleAgent workspace={workspace}>
      <NormalMode workspace={workspace} sessionId={sessionId} />
      <SpawnTool />
      <ExploreTool />
    </TentickleAgent>
  );
}

// ---------------------------------------------------------------------------
// Normal Mode — full agent with delegation + job management
// ---------------------------------------------------------------------------

function NormalMode({ workspace, sessionId }: { workspace: string; sessionId?: string }) {
  const memoryFile = getMemoryPath(workspace);
  const cronStore = getSchedulerStore();
  const ScheduleTool = useMemo(
    () => (cronStore ? createScheduleTool(cronStore) : null),
    [cronStore],
  );

  // Delegation tools — created from globally-bound app + store
  const app = getApp();
  const store = getSessionStore();
  const DelegateTool = useMemo(
    () => (app && store && sessionId ? createDelegateTool(app, store, sessionId) : null),
    [app, store, sessionId],
  );
  const InspectJobTool = useMemo(
    () => (app && store ? createInspectJobTool(app, store) : null),
    [app, store],
  );
  const ApproveJobTool = useMemo(
    () => (app && store ? createApproveJobTool(app, store) : null),
    [app, store],
  );
  const CancelJobTool = useMemo(
    () => (app && store ? createCancelJobTool(app, store) : null),
    [app, store],
  );

  return (
    <>
      <CodingBehavior workspace={workspace} memoryFile={memoryFile} />
      {ScheduleTool && <ScheduleTool />}
      {DelegateTool && <DelegateTool />}
      {InspectJobTool && <InspectJobTool />}
      {ApproveJobTool && <ApproveJobTool />}
      {CancelJobTool && <CancelJobTool />}
      {store && sessionId && <ActiveJobs store={store} ownerSessionId={sessionId} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Delegate Mode — coding tools + escalation + spec context
// ---------------------------------------------------------------------------

function DelegateMode({
  delegation,
  workspace,
}: {
  delegation: NonNullable<ReturnType<typeof getDelegationMetadata>>;
  workspace: string;
}) {
  const memoryFile = getMemoryPath(workspace);
  const app = getApp();
  const store = getSessionStore();

  const EscalateTool = useMemo(
    () =>
      app && store
        ? createEscalateTool(app, store, delegation.parentSessionId, delegation.sessionId)
        : null,
    [app, store, delegation.parentSessionId, delegation.sessionId],
  );

  return (
    <>
      <DelegateContext delegation={delegation} />
      <CodingBehavior workspace={workspace} memoryFile={memoryFile} />
      {EscalateTool && <EscalateTool />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Supervisor Mode — review tools only, no coding tools
// ---------------------------------------------------------------------------

function SupervisorMode({
  delegation,
}: {
  delegation: NonNullable<ReturnType<typeof getDelegationMetadata>>;
}) {
  const app = getApp();
  const store = getSessionStore();

  const SendTool = useMemo(
    () =>
      app && delegation.delegateSessionId
        ? createSendToDelegateTool(app, delegation.delegateSessionId)
        : null,
    [app, delegation.delegateSessionId],
  );
  const InspectTool = useMemo(
    () =>
      app && delegation.delegateSessionId
        ? createInspectDelegateTool(app, delegation.delegateSessionId)
        : null,
    [app, delegation.delegateSessionId],
  );
  const CompleteTool = useMemo(
    () => (app && store ? createCompleteDelegationTool(app, store, delegation.sessionId) : null),
    [app, store, delegation.sessionId],
  );
  const EscalateTool = useMemo(
    () =>
      app && store
        ? createEscalateTool(app, store, delegation.parentSessionId, delegation.sessionId)
        : null,
    [app, store, delegation.parentSessionId, delegation.sessionId],
  );
  const VerifyTool = useMemo(() => createRunVerificationTool(), []);

  return (
    <>
      <SupervisorContext delegation={delegation} />
      {SendTool && <SendTool />}
      {InspectTool && <InspectTool />}
      {CompleteTool && <CompleteTool />}
      {EscalateTool && <EscalateTool />}
      <VerifyTool />
    </>
  );
}

// ---------------------------------------------------------------------------
// CodingBehavior — shared system prompt, conventions, gate, continuation
// ---------------------------------------------------------------------------

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
        You are a coding agent working in: `{workspace}`<h2>CORE RULES</h2>
        <ul>
          <li>ACT, don't narrate. Never say "I'll read the file" — just call read_file.</li>
          <li>Never describe what you plan to do without doing it in the same response.</li>
          <li>Use tools in EVERY response. If you have nothing to do, say so. Otherwise, act.</li>
          <li>Text output is for the user: brief status, results, decisions. Not narration.</li>
          <li>If something fails, diagnose the root cause — don't retry blindly.</li>
          <li>If the same approach failed twice, try something fundamentally different.</li>
        </ul>
      </System>

      <Section id="tool-mastery" title="Tool Mastery">
        <h3>Shell is your superpower</h3>
        <p>
          Use `shell` for everything it's good at: git operations, running tests, checking file
          existence, inspecting processes, running builds, installing packages, running linters.
          Don't reach for specialized tools when a quick shell command does the job. Use shell to
          chain commands: `cd project {"&&"} pnpm test -- --grep "auth"`.
        </p>

        <h3>Parallel tool calls</h3>
        <p>
          When you need multiple pieces of information, request them ALL in a single response. Read
          3 files? Three read_file calls in one response. Search AND read? Call grep + read_file
          together. Never serialize independent operations — parallel tool calls are your biggest
          throughput multiplier.
        </p>

        <h3>Glob → Grep → Read</h3>
        <p>
          This is the fastest path to understanding code. First, glob to see structure (`**/*.ts`,
          `src/**/*.tsx`). Then grep to find specific patterns. Then read_file to study the exact
          code. Don't skip straight to reading — you'll read the wrong files.
        </p>

        <h3>edit_file over write_file</h3>
        <p>
          ALWAYS prefer edit_file for existing files. write_file replaces the entire file — you risk
          losing content you didn't read. write_file is ONLY for creating new files.
        </p>

        <h3>Web research</h3>
        <p>
          When stuck on an unknown API, library, error message, or you need documentation: use
          web_fetch to read the source. Check package READMEs, official docs, relevant examples. Do
          NOT hallucinate APIs or guess function signatures — look them up.
        </p>
      </Section>

      <Section id="delegation" title="Delegation">
        <h3>Delegate for background work</h3>
        <p>
          Use the delegate tool for tasks that take many iterations and don't need your direct
          involvement. Dispatch mode runs autonomously; supervised mode has a reviewer ensuring
          quality. You remain available for other work while delegations run in background sessions.
        </p>

        <h3>Spawn for immediate sub-tasks</h3>
        <p>
          When a task has independent sub-tasks, spawn agents for each. Each sub-agent has full
          workspace access and its own tool budget. Good spawn targets: writing tests while you
          implement, exploring a different module, running verification while you continue,
          refactoring a subsystem.
        </p>
        <p>
          For concurrent work, call spawn multiple times in one response — they run in parallel.
          This is massively more efficient than sequential execution.
        </p>

        <h3>Explore for research</h3>
        <p>
          Use explore when you need to understand a module, find patterns, or map dependencies.
          Don't waste main context on open-ended exploration — delegate it. The explore agent
          reports back with findings so you can act on them.
        </p>

        <h3>task_list for planning</h3>
        <p>
          Before any non-trivial work, use task_list with action "plan" to break the work into
          steps. Execute step by step, marking tasks complete as you go. This keeps you organized
          and shows the user your progress. For multi-file changes, plan the dependency order: types
          → implementation → tests.
        </p>
      </Section>

      <Section id="edit-strategy" title="Edit Strategy">
        <h3>Read before editing. Always.</h3>
        <p>
          Never edit a file you haven't read in this session. The file may have changed since your
          training data. Read it, understand the surrounding code, then make targeted edits.
        </p>

        <h3>Verify after every edit</h3>
        <p>
          After editing: run the fastest verification available. Priority order: 1. `shell` with
          typecheck (catches type errors in seconds) 2. `shell` with relevant tests (catches logic
          errors) 3. `shell` with lint (catches style issues) Run the fastest one first. If it
          passes, run the next. Don't batch all edits then verify — verify incrementally so you
          catch problems early.
        </p>

        <h3>Multi-file refactors</h3>
        <p>
          Plan first via task_list. Execute in dependency order: types and interfaces →
          implementation → call sites → tests. Verify after each logical group, not after every
          single file (too slow) and not after all files (too late to catch errors).
        </p>

        <h3>When verification fails</h3>
        <p>
          Read the actual error message. Fix the root cause. If you get the same error after two fix
          attempts, step back: re-read the relevant code, check if your mental model is wrong,
          consider a different approach entirely.
        </p>
      </Section>

      <Section id="context-management" title="Context Management">
        <h3>Be surgical with reads</h3>
        <p>
          Don't read entire large files. Use grep to find the relevant section, then read_file with
          line range for targeted content. A 2000-line file wastes context when you only need 20
          lines.
        </p>

        <h3>Summarize findings</h3>
        <p>
          When context is getting full, summarize what you've learned rather than dumping raw tool
          output. "The auth module uses JWT with RS256, tokens expire in 1h, refresh tokens in 30d"
          is better than pasting the entire auth config.
        </p>

        <h3>Memory for cross-session knowledge</h3>
        <p>
          On first encounter with a project, orient immediately: glob structure, read key config
          files (package.json, tsconfig, CI config), then write findings to `{memoryFile}`. Include:
          project name, build commands, test commands, key directories, conventions. If "Project
          Memory" appears in context, you already know this project — use that knowledge.
        </p>
      </Section>

      {verification.element}
    </>
  );
}
