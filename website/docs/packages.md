# Package Overview

```
tentickle/
├── agents/
│   ├── coding/          @tentickle/coding
│   └── main/            @tentickle/main
├── packages/
│   ├── agent/           @tentickle/agent
│   ├── artifacts/       @tentickle/artifacts
│   ├── tools/           @tentickle/tools
│   └── tentickle/       tentickle (meta-package)
```

## `@tentickle/agent`

The shared base component. Provides `<TentickleAgent>` which wires up:

- OS-level sandbox via `@agentick/sandbox-local`
- Dynamic model selection (OpenAI, Google, Apple)
- Identity, user context, entity awareness
- Workspace grounding, project conventions
- Persistent memory, rules, skills
- Enhanced timeline with tiered compaction
- Universal tools (sandbox tools, glob, grep, task list, add-dir)
- Knobs for reactive model-visible state
- Layered settings system
- Connector startup for Telegram and iMessage

Also exports tool factories (`createSpawnTool`, `createExploreTool`, `createTaskTool`), artifact tool factories, and path helpers for the `~/.tentickle/` data directory.

## `@tentickle/coding`

The coding agent. Adds:

- Coding-specific system prompt and conventions
- Verification gate (auto-activates after file edits)
- Spawn and explore tools (self-referencing — the spawned agent is another CodingAgent)
- Scheduler integration for cron jobs
- Custom TUI with task list, context injection, tool confirmations

## `@tentickle/main`

The main/personal agent. Adds:

- Orchestration-focused system prompt
- Entity and human profile maintenance behaviors
- Data location context
- Spawn and explore tools

## `@tentickle/artifacts`

Named, typed, queryable worker outputs. Workers call `store_artifact` to declare what they produced. The kernel queries artifacts by session ID when a worker completes, so the orchestrator knows exactly what was produced without parsing free-text responses.

Three tools (`store_artifact`, `get_artifact`, `list_artifacts`) are wired into `<TentickleAgent>` automatically. `ArtifactStore` is a thin SQLite class — no embeddings, no FTS, just relational queries by session, name, and type.

Same architecture as memory: `createTool`-based library, global binding (`bindArtifactStore`/`getArtifactStore`), versioned migrations, shared SQLite database.

## `@tentickle/tools`

File search tools that complement the sandbox's built-in tools:

- `<Glob />` — find files by pattern (glob syntax)
- `<Grep />` — search file contents by regex

## `tentickle`

Meta-package and future CLI entry point (`npx tentickle`). Re-exports from all packages.

## Dependency Graph

```
tentickle
├── @tentickle/coding
│   └── @tentickle/agent
│       ├── @tentickle/artifacts
│       ├── @tentickle/memory
│       └── @tentickle/tools
└── @tentickle/main
    └── @tentickle/agent
        ├── @tentickle/artifacts
        ├── @tentickle/memory
        └── @tentickle/tools
```

All packages depend on `@agentick/*` packages (linked from the sibling agentick repo via `pnpm.overrides`).
