# Coding Agent

The coding agent (`@tentickle/coding`) is an autonomous software engineer. It reads code, writes changes, runs commands, and verifies its work inside a sandboxed workspace.

## Architecture

The agent is a thin layer on the [shared base](./packages):

```tsx
function CodingAgent({ workspace }) {
  const verification = useGate("verification", verificationGate);

  return (
    <TentickleAgent workspace={workspace}>
      <CodingBehavior />
      <SpawnTool />
      <ExploreTool />
      {ScheduleTool && <ScheduleTool />}
      {verification.element}
    </TentickleAgent>
  );
}
```

`<TentickleAgent>` provides sandbox, model, memory, tools, timeline. The coding agent adds:

- A coding-specific system prompt with behavioral rules
- A conventions section (task planning, verification, memory patterns)
- A [verification gate](./gates) that auto-activates after file edits
- Spawn and explore tools for sub-agent delegation
- Scheduled job support via `@agentick/scheduler`

## Tools

| Tool | Description |
|------|-------------|
| `shell` | Run commands in the workspace |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Surgical edits with 3-level matching |
| `glob` | Find files by pattern |
| `grep` | Search file contents by regex |
| `task_list` | Plan, track, and complete multi-step work |
| `spawn` | Delegate sub-tasks to parallel child agents |
| `explore` | Open-ended research via sub-agent |
| `add-dir` | Mount additional directories at runtime |
| `set_knob` | Expand collapsed context, clear gates |
| `schedule` | Create scheduled jobs |

## Behavioral Rules

The system prompt enforces:

1. **Act, don't narrate.** Never say "I'll read the file" — just call `read_file`.
2. **Use tools in every response.** If there's nothing to do, say so. Otherwise, act.
3. **Read before editing.** Verify changes with `shell`.
4. **Diagnose root causes.** Don't retry blindly on failure.

## Continuation Logic

The agent runs until:
- All tasks are complete (if it created any)
- It hits the 50-tick safety limit
- It explicitly stops

```tsx
useContinuation((result) => {
  if (result.tick >= 50) return false;
  const tasks = taskStore.list();
  if (tasks.length > 0 && taskStore.hasIncomplete()) return true;
});
```

## Sub-Agent Spawning

The `spawn` tool creates child agents for independent work:

```
Parent Agent
├── spawn("research the auth module")  → Child 1
├── spawn("write tests for utils")     → Child 2
└── continues working on its own tasks
```

Each spawned agent gets full workspace access (same sandbox), its own task store, and its own model calls (parallel execution).
