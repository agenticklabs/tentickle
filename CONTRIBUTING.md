# Contributing

## Setup

Tentickle is co-developed with [agentick](https://github.com/agenticklabs/agentick). You need both repos side by side.

```bash
# Prerequisites: Node.js 24+, pnpm 10+

git clone https://github.com/agenticklabs/agentick.git
git clone https://github.com/agenticklabs/tentickle.git

# Build agentick first
cd agentick && pnpm install && pnpm build && cd ..

# Install tentickle (links agentick via pnpm.overrides)
cd tentickle && pnpm install
```

Agentick packages are linked from the sibling repo — not installed from npm. When you change agentick, rebuild it and the changes are immediately available here.

## Running

```bash
pnpm --filter @tentickle/coding start   # Launch the agent
pnpm --filter @tentickle/coding dev     # Dev mode (auto-reload)
```

## Project Structure

```
tentickle/
├── packages/
│   ├── tentickle/     # tentickle — CLI binary + re-exports
│   └── tools/         # @tentickle/tools — Glob, Grep
├── agents/
│   └── coding/        # @tentickle/coding — agent, TUI, connectors
├── CLAUDE.md          # Project guide
├── AGENTS.md          # Architecture & framework gaps
└── ROADMAP.md         # Development phases
```

## Checks

All must pass before committing:

```bash
pnpm build       # Build all packages
pnpm test        # Run tests (vitest)
pnpm typecheck   # TypeScript strict mode
pnpm lint        # Lint (oxlint)
```

Pre-commit hooks run `format:check` and `lint:all` automatically.

## Code Standards

- TypeScript strict mode. No `any` except at true system boundaries.
- Named exports only. No default exports.
- Files: kebab-case. Types: PascalCase. Functions: camelCase.
- Prefer editing existing files over creating new ones.
- No over-engineering. Three similar lines > a premature abstraction.
- Comments only where logic is non-obvious.
- Tests are mandatory for agent behaviors and tool handlers.
- `.tsx` for files with JSX. The JSX runtime is React (via agentick's reconciler).

## Commits

Follow conventional commits:

```
feat: add verification loop to coding agent
fix: resolve sandbox path resolution on Linux
docs: update roadmap with Phase 6
refactor: extract timeline compaction logic
test: add adversarial tests for spawn lifecycle
```

## The Dual-Repo Workflow

When you hit a framework limitation in agentick while building an agent feature:

1. Don't work around it. No shims, no hacks.
2. Note the gap in `AGENTS.md` under "Framework Gaps."
3. Fix it in agentick and PR it upstream.
4. Then build the agent feature on the improved primitive.

This is the whole point of tentickle — it pushes agentick forward.

## AI Agents

If you're an AI agent contributing to this repo:

- Read `CLAUDE.md` for project overview and conventions.
- Read `AGENTS.md` for architecture and framework gaps.
- Check `@agentick/shared` before writing any utility function.
- Run `pnpm test && pnpm typecheck` after every change.
- Tests must be adversarial — target edges, not happy paths.
