import React from "react";
import { useState, useEffect, useMemo, createContext, useContext } from "react";
import { Knobs } from "@agentick/core";
import { Sandbox, SandboxTools } from "@agentick/sandbox";
import { localProvider } from "@agentick/sandbox-local";
import type { SandboxProvider, Mount, Permissions, ResourceLimits } from "@agentick/sandbox";
import { Glob, Grep } from "@tentickle/tools";
import { existsSync, mkdirSync } from "node:fs";

import { Identity } from "./identity.js";
import { DynamicModel } from "./model.js";
import { WorkspaceGrounding, ProjectConventions } from "./grounding.js";
import { Memory, ClaudeMemory } from "./memory.js";
import { Skills } from "./skills.js";
import { EnhancedTimeline } from "./timeline.js";
import { TaskStore, bindTaskStore } from "./task-store.js";
import { createTaskTool } from "./tools/task-list.js";
import { createRememberTool, createRecallTool, getMemory } from "@tentickle/memory";
import type { TentickleMemory } from "@tentickle/memory";
import { AddDirCommand } from "./tools/add-dir.js";
import { UserContext } from "./user-context.js";
import { EntityAwareness } from "./entities.js";
import { Rules } from "./rules.js";
import { getProjectDir, getSkillsDirs, getUserDir, getEntitiesDir } from "./paths.js";
import { scaffoldGlobalDataDir, loadSettings, type TentickleSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// Context: expose internals to consumer components
// ---------------------------------------------------------------------------

interface TentickleContext {
  taskStore: TaskStore;
  settings: TentickleSettings;
  workspace: string;
  memory: TentickleMemory | null;
}

const TentickleCtx = createContext<TentickleContext | null>(null);

export function useTentickle(): TentickleContext {
  const ctx = useContext(TentickleCtx);
  if (!ctx) throw new Error("useTentickle() must be used within <TentickleAgent>");
  return ctx;
}

// ---------------------------------------------------------------------------
// TaskStoreBridge: binds the per-instance store to the global ref for TUI
// ---------------------------------------------------------------------------

function TaskStoreBridge({ store }: { store: TaskStore }) {
  useEffect(() => {
    bindTaskStore(store);
  }, [store]);
  return null;
}

// ---------------------------------------------------------------------------
// TentickleAgent
// ---------------------------------------------------------------------------

export interface TentickleAgentProps {
  workspace?: string;
  provider?: SandboxProvider;
  mounts?: Mount[];
  allow?: Permissions;
  env?: Record<string, string | (() => string)>;
  limits?: ResourceLimits;
  /** Load ~/.tentickle/IDENTITY.md into context. Default: true. */
  identity?: boolean;
  /** Cross-session memory instance (created by createTentickleApp). */
  memory?: TentickleMemory;
  children: React.ReactNode;
}

/**
 * Base agent component for all tentickle agents.
 *
 * On mount: scaffolds ~/.tentickle/ data dir, loads layered settings
 * (global → project → project-local), sets up sandbox with mounts for
 * memory and skills directories.
 *
 * Provides: sandbox, identity, dynamic model, knobs, grounding, memory,
 * skills, timeline compaction, and universal tools (sandbox tools, glob,
 * grep, task list, add-dir command).
 *
 * Consumer agents compose on top via children.
 */
export function TentickleAgent({
  workspace = process.cwd(),
  provider,
  mounts: extraMounts,
  allow,
  env,
  limits,
  identity = true,
  memory,
  children,
}: TentickleAgentProps) {
  // Scaffold global data dir (idempotent)
  scaffoldGlobalDataDir();

  // Load layered settings
  const settings = loadSettings(workspace);

  // Ensure project memory directory exists (under ~/.tentickle/projects/{slug}/)
  const projectDir = getProjectDir(workspace);
  mkdirSync(projectDir, { recursive: true });

  // Skills directories (read-only mounts)
  const skillsDirs = getSkillsDirs(workspace);
  const skillsMounts: Mount[] = skillsDirs
    .filter((d) => existsSync(d))
    .map((d) => ({ host: d, sandbox: d, mode: "ro" as const }));

  // Data dir mounts (read-write)
  const userDir = getUserDir();
  const entitiesDir = getEntitiesDir();
  const dataMounts: Mount[] = [
    { host: projectDir, sandbox: projectDir, mode: "rw" },
    { host: userDir, sandbox: userDir, mode: "rw" },
    { host: entitiesDir, sandbox: entitiesDir, mode: "rw" },
  ];

  // Merge all mounts: data + skills + consumer-provided
  const allMounts = [...dataMounts, ...skillsMounts, ...(extraMounts ?? [])];

  // Per-instance task store
  const [taskStore] = useState(() => new TaskStore());
  const TaskTool = useMemo(() => createTaskTool(taskStore), [taskStore]);

  // Memory tools — prop takes precedence, falls back to global binding
  const resolvedMemory = memory ?? getMemory();
  const RememberTool = useMemo(
    () => (resolvedMemory ? createRememberTool(resolvedMemory) : null),
    [resolvedMemory],
  );
  const RecallTool = useMemo(
    () => (resolvedMemory ? createRecallTool(resolvedMemory) : null),
    [resolvedMemory],
  );

  return (
    <Sandbox
      provider={provider ?? localProvider()}
      workspace={workspace}
      mounts={allMounts}
      allow={allow}
      env={env}
      limits={limits}
    >
      <TentickleCtx value={{ taskStore, settings, workspace, memory: resolvedMemory }}>
        <TaskStoreBridge store={taskStore} />
        {identity && <Identity />}
        <UserContext />
        <DynamicModel />
        <Knobs />

        <WorkspaceGrounding workspace={workspace} />
        <ProjectConventions workspace={workspace} />
        <ClaudeMemory workspace={workspace} />
        <Skills workspace={workspace} />
        <EntityAwareness />
        <Rules workspace={workspace} />
        <Memory workspace={workspace} />

        <EnhancedTimeline />

        <SandboxTools />
        <Glob />
        <Grep />
        <TaskTool />
        <AddDirCommand />
        {RememberTool && <RememberTool />}
        {RecallTool && <RecallTool />}

        {children}
      </TentickleCtx>
    </Sandbox>
  );
}
