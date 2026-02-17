# tentickle

**An octopus's garden.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Built on agentick](https://img.shields.io/badge/Built_on-agentick-34d399?style=for-the-badge)](https://github.com/agenticklabs/agentick)

<p align="center">
  <img src="./public/stubs_desk.png" alt="tentickle" width="480" />
</p>

Tentickle is an autonomous coding agent built on [agentick](https://github.com/agenticklabs/agentick) — the component framework for AI. It reads your code, writes changes, runs commands, and verifies its work, all inside a sandboxed workspace. It also serves as agentick's proving ground: every limitation we hit in the framework becomes an upstream fix, not a workaround.

```
tentickle/
├── packages/tools/        # @tentickle/tools — Glob, Grep
└── agents/coding/         # @tentickle/coding — agent, TUI, connectors
```

## What It Does

The coding agent operates in a tick loop — receive task, read context, make changes, verify — with full workspace isolation via OS-level sandboxing (seatbelt on macOS, bwrap on Linux).

**Tools the agent has:**

| Tool | Source | Description |
| --- | --- | --- |
| `shell` | `@agentick/sandbox` | Run commands in the workspace |
| `read_file` | `@agentick/sandbox` | Read file contents |
| `write_file` | `@agentick/sandbox` | Create or overwrite files |
| `edit_file` | `@agentick/sandbox` | Surgical edits with 3-level matching |
| `glob` | `@tentickle/tools` | Find files by pattern |
| `grep` | `@tentickle/tools` | Search file contents by regex |
| `task_list` | built-in | Plan, track, and complete multi-step work |
| `spawn` | built-in | Delegate sub-tasks to parallel child agents |
| `add-dir` | built-in | Mount additional directories at runtime |
| `set_knob` | `@agentick/core` | Expand collapsed context sections |

**What makes it interesting** is that the agent's entire brain is a JSX component tree:

```tsx
function CodingAgent({ workspace }: { workspace: string }) {
  useContinuation((result) => {
    if (result.tick >= 50) return false;
    if (taskStore.hasIncomplete()) return true;
  });

  return (
    <Sandbox provider={localProvider()} workspace={workspace}>
      <DynamicModel />

      <System>
        You are a coding agent working in: `{workspace}`
        ACT, don't narrate. Use tools in EVERY response.
      </System>

      <WorkspaceGrounding workspace={workspace} />
      <ProjectConventions workspace={workspace} />
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
```

Components compose into the context window. Hooks control execution between ticks. Tools render their state back into what the model sees. The framework compiles it all — you just write React.

## Getting Started

> **Not published yet.** The `npx` workflow below is where we're headed. For now, see [Contributing](#contributing) for the dev setup.

```bash
npx tentickle
```

That's the goal. One command — installs the agent, launches the TUI in your current directory. Stubs goes to work.

### Configuration

Create a `.env` in your project root (or export the vars):

```env
# OpenAI (default)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o          # optional, defaults to gpt-4o-mini

# Google (set USE_GOOGLE_MODEL=true to switch)
GOOGLE_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
USE_GOOGLE_MODEL=false

# Apple Foundation Models (macOS, on-device)
USE_APPLE_MODEL=false

# OpenAI-compatible providers (Grok, etc.)
OPENAI_BASE_URL=https://api.x.ai/v1
```

Supports any OpenAI-compatible API, Google (Gemini & Vertex), and Apple Foundation Models. Model selection is dynamic — switch at runtime.

## The TUI

A custom terminal interface built on [Ink](https://github.com/vadimdemedes/ink) and `@agentick/tui`:

- Slash commands (`/help`, `/attach`, `/add-dir`, `/clear`, `/exit`)
- Tab-complete file paths and `@mentions` for context injection
- Tool confirmation prompts with diff rendering
- Attachment strip for images and documents
- Task list display
- Streaming response with tool call indicators
- Spawn indicators for sub-agent delegation
- Queue mode — send messages while the agent is still working

## Context Engineering

The agent doesn't just dump a system prompt and hope. Every piece of context is a component:

- **`<WorkspaceGrounding>`** — package.json name, scripts, git branch. Ephemeral.
- **`<ProjectConventions>`** — reads `CLAUDE.md` or `AGENTS.md` from the workspace root. Read-only.
- **`<ClaudeMemory>`** — reads Claude Code's `MEMORY.md` if present. Read-only.
- **`<Memory>`** — persistent project memory the agent writes to and re-reads after every tick.
- **`<Skills>`** — discovers installed `SKILL.md` files and indexes them.
- **`<EnhancedTimeline>`** — tiered compaction: current execution at full fidelity, older messages collapsed (expandable via `set_knob`), old tool results dropped. Prevents ICL corruption by never putting fake tool metadata in assistant summaries.

## Connectors

The same agent is reachable from multiple surfaces. Connectors are opt-in via environment variables:

```env
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=123456789    # restrict to your user ID

# iMessage (macOS only)
IMESSAGE_HANDLE=+1234567890
```

Each connector gets its own session. The TUI, Telegram, and iMessage all talk to the same app instance through `@agentick/client`.

## Sub-Agent Spawning

The `spawn` tool creates child agents for independent work. Each spawned agent gets:

- Full workspace access (same sandbox)
- Its own task store (isolated state)
- Its own model calls (parallel execution)
- Event bubbling back to the parent

```
Parent Agent
├── spawn("research the auth module")  → Child 1
├── spawn("write tests for utils")     → Child 2
└── continues working on its own tasks
```

## Project Structure

```
tentickle/
├── agents/
│   └── coding/
│       ├── src/
│       │   ├── agent.tsx          # Agent component tree
│       │   ├── model.tsx          # Dynamic model selection
│       │   ├── main.ts            # Entry point — app, client, TUI, connectors
│       │   ├── connectors.ts      # Telegram + iMessage bridges
│       │   ├── task-store.ts      # Per-instance task tracking
│       │   ├── memory-path.ts     # Memory file resolution
│       │   ├── tools/
│       │   │   ├── task-list.tsx   # Plan/track/complete tasks
│       │   │   ├── spawn.tsx       # Sub-agent delegation
│       │   │   └── explore.tsx     # Open-ended research sub-agent
│       │   ├── tui/
│       │   │   ├── index.tsx       # Custom TUI component
│       │   │   ├── commands/       # Slash command definitions
│       │   │   └── components/     # Banner, Footer, TaskList, etc.
│       │   └── components/
│       │       └── timeline.tsx    # Enhanced timeline with compaction
│       └── bin/
│           └── tentickle.ts       # CLI entry point
├── packages/
│   └── tools/
│       └── src/
│           ├── glob.tsx           # File pattern matching tool
│           └── grep.tsx           # Content search tool
├── CLAUDE.md                      # Project guide (for AI agents too)
├── AGENTS.md                      # Architecture & framework gaps
└── ROADMAP.md                     # Development phases
```

## Contributing

Tentickle and [agentick](https://github.com/agenticklabs/agentick) are co-developed. If you want to hack on the agent itself or contribute to the framework, you need both repos side by side.

```bash
# Prerequisites: Node.js 24+, pnpm 10+

# Clone both repos
git clone https://github.com/agenticklabs/agentick.git
git clone https://github.com/agenticklabs/tentickle.git

# Build agentick first (tentickle links it via pnpm.overrides)
cd agentick && pnpm install && pnpm build && cd ..

# Install and run
cd tentickle && pnpm install
pnpm --filter @tentickle/coding start   # Launch the agent
pnpm --filter @tentickle/coding dev     # Dev mode with auto-reload
```

When you change agentick, rebuild it (`cd ../agentick && pnpm build`) and the changes are immediately available in tentickle.

```bash
pnpm build       # Build all packages
pnpm test        # Run tests
pnpm typecheck   # TypeScript strict mode
```

## Status

Early. The agent works and handles real coding tasks, but there's no CLI binary you can `npx`, no `init` command, no `doctor`. The TUI is functional but not polished. The system prompt is tuned but not optimized. See [ROADMAP.md](ROADMAP.md) for what's done and what's next.

What works today:
- Autonomous multi-step coding tasks with tool use
- Sandboxed workspace isolation
- Sub-agent spawning for parallel work
- Task planning and tracking
- Persistent project memory
- Multi-model support (OpenAI-compatible, Google (Gemini & Vertex), Apple (FoundationModel))
- Telegram and iMessage connectors
- Rich terminal UI with confirmations, completions, and attachments

What's missing:
- Installable CLI (`npx tentickle`)
- Session persistence across restarts
- Streaming message display (currently shows "Thinking..." spinner)
- Error recovery patterns
- Verification loops (auto-run tests after edits)
- Specialized agents (review, test, debug)

## Philosophy

**No workarounds.** When the agent hits a framework limitation, we fix it in agentick and PR it upstream. The agents we build here push the framework forward — they don't paper over its gaps.

**Composition over monoliths.** The coding agent isn't one giant prompt. It's components that compose: tools, context sections, hooks, grounding. Swap one out, add another, conditionally render based on task type.

**Beauty is the goal.** If the code is ugly, it's wrong. If a type is misnamed, fix it. If a module boundary is awkward, redraw it. No "for now" compromises.

## License

MIT
