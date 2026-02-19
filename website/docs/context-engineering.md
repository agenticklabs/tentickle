# Context Engineering

The agent doesn't dump a system prompt and hope. Every piece of context is a component in the JSX tree, rendered into the model's context window at compile time.

## Context Layers

```tsx
<TentickleAgent workspace={workspace}>
  <Identity />              {/* ~/.tentickle/IDENTITY.md */}
  <UserContext />            {/* ~/.tentickle/user/*.md */}
  <DynamicModel />           {/* Provider selection */}
  <Knobs />                  {/* Reactive state controls */}

  <WorkspaceGrounding />     {/* package.json, git branch, scripts */}
  <ProjectConventions />     {/* CLAUDE.md or AGENTS.md */}
  <ClaudeMemory />           {/* Claude Code's MEMORY.md (read-only) */}
  <Skills />                 {/* Discovered SKILL.md files */}
  <EntityAwareness />        {/* Entity profile index */}
  <Rules />                  {/* Global + project rules */}
  <Memory />                 {/* Project MEMORY.md */}

  <EnhancedTimeline />       {/* Conversation history */}

  <SandboxTools />           {/* Shell, read, write, edit */}
  <Glob />                   {/* File search */}
  <Grep />                   {/* Content search */}
  <TaskTool />               {/* Task management */}
  <AddDirCommand />          {/* Runtime mount */}

  {children}                 {/* Agent-specific behavior */}
</TentickleAgent>
```

Each component loads data (often async via `useOnMount`), manages state, and renders into the model's context. When state changes, the reconciler diffs and recompiles.

## Grounding vs Sections

- **`<Grounding>`** — injected once at the top of context. Workspace info, project conventions, entity index. The model sees it but can't interact with it.
- **`<Section>`** — collapsible context blocks. Conventions, data locations, user context. Can be expanded/collapsed via knobs.

## Timeline Compaction

The `<EnhancedTimeline>` component implements tiered compaction:

1. **Current execution** — full fidelity, every message and tool result
2. **Recent history** — messages preserved, large tool results truncated
3. **Older history** — collapsed to `[ref:N]` summaries, expandable via `set_knob`

Compaction preserves ICL safety — it never puts fake tool metadata in assistant message summaries, which would corrupt the model's understanding of the conversation structure.

## Memory

Two types of persistent memory:

- **Project memory** (`~/.tentickle/projects/{slug}/MEMORY.md`) — written and read by the agent each session. Build commands, project structure, verification procedures, patterns discovered.
- **Claude memory** (`~/.claude/projects/{slug}/memory/`) — read-only. If the human uses Claude Code, the agent can see (but not modify) its memory files.

## Rules

Rules are markdown files that inject behavioral constraints:

- **Global rules** (`~/.tentickle/rules/*.md`) — apply to all projects
- **Project rules** (`~/.tentickle/projects/{slug}/rules/*.md`) — project-specific overrides

If total content is small (<3000 chars), rules are inlined. Otherwise, an index is shown and the agent reads full rules on demand.
