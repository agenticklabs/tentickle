# Getting Started

Tentickle is a family of autonomous agents built on [agentick](https://agenticklabs.github.io/agentick/). It's not published to npm yet — you need both repos cloned side by side.

## Prerequisites

- Node.js 24+
- pnpm 10+

## Setup

```bash
# Clone both repos
git clone https://github.com/agenticklabs/agentick.git
git clone https://github.com/agenticklabs/tentickle.git

# Build agentick first (tentickle links it via pnpm.overrides)
cd agentick && pnpm install && pnpm build && cd ..

# Install tentickle
cd tentickle && pnpm install
```

## Running

```bash
# Launch the coding agent
pnpm --filter @tentickle/coding start

# Launch the main agent
pnpm --filter @tentickle/main start

# Dev mode (auto-reload on changes)
pnpm --filter @tentickle/coding dev
```

The agent launches a TUI in your terminal, sandboxed to your current working directory (or the git root if inside a repo).

## Configuration

Create a `.env` in the tentickle root:

```bash
# OpenAI (default)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Google (set USE_GOOGLE_MODEL=true to switch)
GOOGLE_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
USE_GOOGLE_MODEL=false

# Apple Foundation Models (macOS, on-device)
USE_APPLE_MODEL=false

# OpenAI-compatible providers
OPENAI_BASE_URL=https://api.x.ai/v1
```

See [Configuration](./configuration) for the full layered settings system.

## What Happens on First Run

1. The agent scaffolds `~/.tentickle/` (global data directory)
2. It creates a project directory for your workspace (`~/.tentickle/projects/{slug}/`)
3. The TUI starts — type your task and press Enter
4. The agent reads your workspace, makes a plan, and starts working

On subsequent runs, the agent reads its project memory from `MEMORY.md` and picks up where it left off.
