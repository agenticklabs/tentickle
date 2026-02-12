# Tentickle — Project Guide

## What This Is

Tentickle is a coding agent built on the [agentick](../agentick) framework. It
serves two purposes:

1. **A production coding agent** — specialized agents that compose into a
   capable autonomous coding system.
2. **The proving ground for agentick** — every limitation we hit in the
   framework becomes an upstream improvement, not a workaround.

## Dual-Repo Workflow

Tentickle and agentick are developed together. Agentick is **not** a static
dependency — it is a sibling repo we actively co-develop.

- `../agentick/` — the framework. JSX reconciler, components, hooks, sessions,
  adapters, sandbox, testing utilities.
- `./` — this repo. Agent implementations, TUI, tooling, compositions.

Agentick packages are linked from the sibling repo via `pnpm.overrides` in the
root `package.json`. Run `pnpm build` in `../agentick/` first.

When you encounter a framework limitation:

1. **Do not work around it.** No shims, no hacks, no "we'll fix it later."
2. Note the deficiency in `AGENTS.md` under "Framework Gaps."
3. Fix it in agentick and issue a PR.
4. Then build the agent feature on the improved primitive.

## Code Standards

**No backwards compatibility.** No legacy code. No dead code paths. No
deprecations. If something is wrong, fix it. If something is unused, delete it.
Clean, direct, well-crafted code only.

- TypeScript strict mode. No `any` except at true system boundaries.
- Named exports only. No default exports.
- Files: kebab-case. Types: PascalCase. Functions: camelCase.
- Prefer editing over creating. Don't add files unless necessary.
- No over-engineering. No premature abstraction. Three similar lines > a helper
  used once.
- Comments only where logic is non-obvious. No doc comments on self-evident code.
- Tests are mandatory for agent behaviors and tool handlers.

## Monorepo Structure

```
tentickle/
├── packages/
│   └── tools/          # @tentickle/tools — Glob, Grep (supplements sandbox)
├── agents/
│   └── coding/         # @tentickle/coding — agent + TUI + CLI entry point
├── CLAUDE.md           # This file
├── AGENTS.md           # Agent architecture & mission
├── ROADMAP.md          # Development phases
└── CONTRIBUTING.md     # Development conventions
```

## Key Dependencies

From `@agentick/sandbox`: `Shell`, `ReadFile`, `WriteFile`, `EditFile`, `<Sandbox>`,
`useSandbox()`. These are the core file/exec tools — we don't rebuild them.

From `@agentick/sandbox-local`: `localProvider()` — OS-level sandboxing (seatbelt
on macOS, bwrap on Linux). Constrains the agent to the workspace.

From `@agentick/tui`: `createTUI()`, `Chat`, `MessageList`, `StreamingMessage`,
`InputBar`, `ToolCallIndicator`, `ErrorDisplay`. The terminal UI foundation.

From `@tentickle/tools`: `Glob`, `Grep` — file search tools that complement
the sandbox's built-in tools.

## Agentick Framework Reference

- **Components**: `<System>`, `<Timeline>`, `<Section>`, `<Message>`, `<Event>`,
  `<Ephemeral>`, `<Grounding>`, semantic formatting (`<List>`, `<Table>`, etc.)
- **Hooks**: `useState`, `useEffect`, `useSignal`, `useOnMount`, `useOnTickEnd`,
  `useContinuation`, `useKnob`, `useData`, `useComState`, `useContextInfo`
- **Tools**: `createTool` — dual-use (JSX component + `.run()` static). Tools
  render state back into context via `render` function.
- **Sandbox**: `<Sandbox>` wraps tools in a workspace. `useSandbox()` gives
  access to the sandbox handle. Tools are tree-scoped.
- **Sessions**: Long-lived conversation contexts. `send()` creates executions.
  Each model call is a tick. Multi-tick via tool use.
- **Adapters**: `openai()`, `google()`, `aiSdk()` — all return `ModelClass`.
- **Testing**: `renderAgent`, `compileAgent`, `createTestAdapter`, mocks.
- **TUI**: `@agentick/tui` — Ink-based terminal interface, local or remote.

See `../agentick/README.md` for full API reference.

## Running

```bash
# First time: build agentick
cd ../agentick && pnpm build && cd ../tentickle

# Install deps (links agentick via overrides)
pnpm install

# Run the coding agent
pnpm --filter @tentickle/coding start

# Development mode (auto-reload)
pnpm --filter @tentickle/coding dev
```

## Build & Test

```bash
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm typecheck        # TypeScript check
pnpm lint             # Lint all packages
```

All must pass before committing.
