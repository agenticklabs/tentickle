# tentickle

**An octopus's garden.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Built on agentick](https://img.shields.io/badge/Built_on-agentick-34d399?style=for-the-badge)](https://github.com/agenticklabs/agentick)

<p align="center">
  <img src="https://raw.githubusercontent.com/agenticklabs/tentickle/master/public/stubs_desk.png" alt="tentickle" width="480" />
</p>

Tentickle is a family of autonomous agents built on [agentick](https://github.com/agenticklabs/agentick) — the component framework for AI. Each agent is a JSX component tree: tools, context, hooks, and behavior composed declaratively. Tentickle also serves as agentick's proving ground — every framework limitation becomes an upstream fix, not a workaround.

## Agents

### Coding Agent (`@tentickle/coding`)

An autonomous software engineer. Reads code, writes changes, runs commands, verifies its work — all inside a sandboxed workspace with OS-level isolation (seatbelt on macOS, bwrap on Linux).

```tsx
function CodingAgent({ workspace }: CodingAgentProps) {
  const verification = useGate("verification", verificationGate);

  return (
    <TentickleAgent workspace={workspace}>
      <CodingBehavior />
      <SpawnTool />
      <ExploreTool />
      {verification.element}
    </TentickleAgent>
  );
}
```

The coding agent adds verification gates (auto-triggered after file edits — the model must run checks before completing), spawn/explore tools for sub-agent delegation, and a coding-specific system prompt on top of the shared base.

### Main Agent (`@tentickle/main`)

A personal orchestration agent. Maintains knowledge about its human, tracks entity profiles (people, projects, orgs), delegates specialist work, and navigates its filesystem-based memory to stay context-aware across conversations.

```tsx
function MainAgent({ workspace }: MainAgentProps) {
  return (
    <TentickleAgent workspace={workspace}>
      <MainBehavior />
      <SpawnTool />
      <ExploreTool />
    </TentickleAgent>
  );
}
```

## Shared Base (`@tentickle/agent`)

Both agents compose on `<TentickleAgent>` — a base component that wires up everything an agent needs:

| Layer            | What it provides                                                                 |
| ---------------- | -------------------------------------------------------------------------------- |
| **Sandbox**      | OS-level workspace isolation via `@agentick/sandbox-local`                       |
| **Identity**     | `~/.tentickle/IDENTITY.md` — the agent's self-authored soul document             |
| **Model**        | Dynamic multi-provider selection (OpenAI, Google, Apple)                         |
| **Context**      | Workspace grounding, project conventions, CLAUDE.md, rules                       |
| **Memory**       | Per-project persistent memory (`~/.tentickle/projects/{slug}/MEMORY.md`)         |
| **User Profile** | Info the agent maintains about its human (`~/.tentickle/user/`)                  |
| **Entities**     | People, orgs, things the agent knows about (`~/.tentickle/entities/`)            |
| **Skills**       | Discovered `SKILL.md` files from project and global directories                  |
| **Rules**        | Layered rules (global + project-level, with override semantics)                  |
| **Timeline**     | Tiered compaction — current execution at full fidelity, older messages collapsed |
| **Tools**        | Sandbox tools, Glob, Grep, task list, add-dir command                            |
| **Knobs**        | Model-visible reactive state with `set_knob` tool                                |

Consumer agents add behavior on top: system prompts, gates, continuation logic, specialized tools. The base handles infrastructure.

## Tools

| Tool         | Source                | Description                                 |
| ------------ | --------------------- | ------------------------------------------- |
| `shell`      | `@agentick/sandbox`   | Run commands in the workspace               |
| `read_file`  | `@agentick/sandbox`   | Read file contents                          |
| `write_file` | `@agentick/sandbox`   | Create or overwrite files                   |
| `edit_file`  | `@agentick/sandbox`   | Surgical edits with 3-level matching        |
| `glob`       | `@tentickle/tools`    | Find files by pattern                       |
| `grep`       | `@tentickle/tools`    | Search file contents by regex               |
| `task_list`  | `@tentickle/agent`    | Plan, track, and complete multi-step work   |
| `spawn`      | `@tentickle/agent`    | Delegate sub-tasks to parallel child agents |
| `explore`    | `@tentickle/agent`    | Open-ended research via sub-agent           |
| `add-dir`    | `@tentickle/agent`    | Mount additional directories at runtime     |
| `set_knob`   | `@agentick/core`      | Expand collapsed context, clear gates       |
| `schedule`   | `@agentick/scheduler` | Create scheduled jobs and heartbeats        |

## Verification Gates

Gates are named checkpoints that block the model from completing until cleared. The coding agent uses a verification gate that auto-activates when files are edited:

```
Model edits files (tick N)
  └─ tick end: gate activates
  └─ model would stop → gate forces continuation

Model gets another turn (tick N+1)
  └─ sees: "VERIFICATION PENDING: verify your changes..."
  └─ runs typecheck, tests, lint
  └─ clears the gate via set_knob

Tick N+1 ends
  └─ gate is clear → execution completes normally
```

Three states: `inactive` (default), `active` (blocking, instructions visible), `deferred` (blocking but silent — un-defers at exit). The model controls gates through the existing `set_knob` tool.

## Data Directory

Tentickle stores persistent state in `~/.tentickle/`:

```
~/.tentickle/
├── IDENTITY.md              # Agent's self-authored identity document
├── settings.json            # Global settings (provider, model, etc.)
├── user/                    # Owner profile — info about the human
├── entities/                # Entity profiles (people, orgs, projects)
├── rules/                   # Global rules (markdown files)
├── skills/                  # Global skill definitions
└── projects/
    └── {workspace-slug}/
        ├── MEMORY.md        # Per-project persistent memory
        └── rules/           # Project-specific rules
```

Settings layer: global (`~/.tentickle/settings.json`) < project (`.tentickle/settings.json`) < project-local (`.tentickle/settings.local.json`).

## The TUI

A custom terminal interface built on [Ink](https://github.com/vadimdemedes/ink) and `@agentick/tui`:

- Slash commands (`/help`, `/attach`, `/add-dir`, `/clear`, `/exit`, `/config`)
- Tab-complete file paths and `@mentions` for context injection
- Tool confirmation prompts with diff rendering
- Attachment and context file strips with keyboard navigation
- Task list display with live status updates
- Streaming response with tool call and spawn indicators
- Queue mode — send messages while the agent is still working

## Connectors

The same agent is reachable from multiple surfaces via `@agentick/connector`:

```env
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=123456789

# iMessage (macOS only)
IMESSAGE_HANDLE=+1234567890
```

Each connector gets its own session. The TUI, Telegram, and iMessage all talk to the same app instance.

## Configuration

Create a `.env` in your project root (or export the vars):

```env
# OpenAI (default)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Google (set USE_GOOGLE_MODEL=true to switch)
GOOGLE_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
USE_GOOGLE_MODEL=false

# Apple Foundation Models (macOS, on-device)
USE_APPLE_MODEL=false

# OpenAI-compatible providers (Grok, etc.)
OPENAI_BASE_URL=https://api.x.ai/v1
```

Or use the layered settings system: `~/.tentickle/settings.json` (global), `.tentickle/settings.json` (project), `.tentickle/settings.local.json` (local, gitignored).

## Project Structure

```
tentickle/
├── agents/
│   ├── coding/                    # @tentickle/coding
│   │   ├── src/
│   │   │   ├── agent.tsx          # Coding agent — gates, spawn, system prompt
│   │   │   ├── main.ts            # Entry point — app, client, TUI, connectors
│   │   │   └── tui/               # Custom TUI with task list, context strip
│   │   └── bin/
│   │       └── tentickle.ts       # CLI entry point
│   └── main/                      # @tentickle/main
│       └── src/
│           ├── agent.tsx          # Main agent — orchestration, entities
│           └── main.ts            # Entry point
├── packages/
│   ├── agent/                     # @tentickle/agent — shared base component
│   │   └── src/
│   │       ├── agent.tsx          # <TentickleAgent> base
│   │       ├── identity.tsx       # ~/.tentickle/IDENTITY.md loader
│   │       ├── model.tsx          # Dynamic multi-provider model selection
│   │       ├── grounding.tsx      # Workspace grounding, project conventions
│   │       ├── memory.tsx         # Persistent project + Claude memory
│   │       ├── entities.tsx       # Entity profile discovery
│   │       ├── user-context.tsx   # Owner profile loader
│   │       ├── rules.tsx          # Layered rules (global + project)
│   │       ├── skills.tsx         # Skill discovery
│   │       ├── timeline.tsx       # Enhanced timeline with compaction
│   │       ├── settings.ts        # Layered settings system
│   │       ├── paths.ts           # Data directory resolution
│   │       ├── connectors.ts      # Telegram + iMessage bridges
│   │       └── tools/             # Task list, spawn, explore, add-dir
│   ├── tools/                     # @tentickle/tools — Glob, Grep
│   └── tentickle/                 # tentickle — meta-package & CLI binary
├── CLAUDE.md
└── AGENTS.md
```

## Contributing

Tentickle and [agentick](https://github.com/agenticklabs/agentick) are co-developed. You need both repos side by side.

```bash
# Prerequisites: Node.js 24+, pnpm 10+

git clone https://github.com/agenticklabs/agentick.git
git clone https://github.com/agenticklabs/tentickle.git

# Build agentick first (tentickle links it via pnpm.overrides)
cd agentick && pnpm install && pnpm build && cd ..

# Install and run
cd tentickle && pnpm install
pnpm --filter @tentickle/coding start   # Launch the coding agent
pnpm --filter @tentickle/main start     # Launch the main agent
pnpm --filter @tentickle/coding dev     # Dev mode with auto-reload
```

When you change agentick, rebuild it (`cd ../agentick && pnpm build`) and the changes are immediately available in tentickle.

```bash
pnpm build       # Build all packages
pnpm test        # Run tests
pnpm typecheck   # TypeScript strict mode
```

## Status

Early. The agents work and handle real tasks, but there's no polished CLI binary you can `npx`, no `init` command, no `doctor`.

What works today:

- Autonomous multi-step coding with tool use and verification gates
- Personal agent with entity awareness and persistent human profile
- Sandboxed workspace isolation (OS-level)
- Sub-agent spawning for parallel work
- Task planning and tracking
- Persistent project memory and layered settings
- Multi-model support (OpenAI-compatible, Google, Apple)
- Scheduled jobs and heartbeats via `@agentick/scheduler`
- Telegram and iMessage connectors
- Rich terminal UI with confirmations, completions, context injection, and attachments

What's missing:

- Installable CLI (`npx tentickle`)
- Session persistence across restarts
- Streaming message display in TUI
- Error recovery patterns
- More specialized agents (review, test, debug)

## Philosophy

**No workarounds.** When the agent hits a framework limitation, we fix it in agentick and PR it upstream. The agents push the framework forward — they don't paper over its gaps.

**Composition over monoliths.** The agent isn't one giant prompt. It's components that compose: tools, context sections, hooks, grounding. Swap one out, add another, conditionally render based on task type.

**Beauty is the goal.** If the code is ugly, it's wrong. If a type is misnamed, fix it. If a module boundary is awkward, redraw it. No "for now" compromises.

## License

MIT
