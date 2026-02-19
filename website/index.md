---
layout: home
hero:
  name: tentickle
  text: Autonomous agents, composed.
  tagline: A family of AI agents built on agentick — the component framework for AI. Each agent is a JSX component tree. Tools, context, hooks, and behavior composed declaratively.
  image:
    src: /stubs.png
    alt: Stubs the octopus at work
  actions:
    - theme: brand
      text: Get Started
      link: /docs/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/agenticklabs/tentickle
features:
  - icon: 🐙
    title: Coding Agent
    details: An autonomous software engineer. Reads code, writes changes, runs commands, verifies its work — all inside a sandboxed workspace with OS-level isolation.
  - icon: 🧠
    title: Main Agent
    details: A personal orchestration agent. Maintains knowledge about its human, tracks entity profiles, delegates specialist work, and navigates filesystem-based memory.
  - icon: 🧱
    title: Composable Base
    details: Both agents compose on TentickleAgent — a shared base that wires up sandbox, identity, memory, grounding, entities, rules, skills, and tools.
  - icon: 🚧
    title: Verification Gates
    details: Named checkpoints that block the model from completing until it verifies its work. Auto-activates after file edits. The model runs tests, typecheck, lint — then clears the gate.
  - icon: 📁
    title: Persistent Memory
    details: "Per-project memory, human profiles, entity files, layered rules. All stored in ~/.tentickle/ — the agent maintains its own knowledge base across conversations."
  - icon: 🔌
    title: Multi-Surface
    details: Same agent, multiple surfaces. TUI, Telegram, iMessage — each gets its own session. Connectors are opt-in via environment variables.
---

<div class="content-section">

## The Agent is a Component Tree

Every tentickle agent is a React component. The framework compiles it into model context — what the model sees, what tools it has, how it behaves between turns.

<div class="code-compare">
<div class="code-block">

### Coding Agent

```tsx
function CodingAgent({ workspace }) {
  const verification = useGate(
    "verification", verificationGate
  );

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

</div>
<div class="code-block">

### Main Agent

```tsx
function MainAgent({ workspace }) {
  return (
    <TentickleAgent workspace={workspace}>
      <MainBehavior />
      <SpawnTool />
      <ExploreTool />
    </TentickleAgent>
  );
}
```

</div>
</div>

`<TentickleAgent>` is the shared base — sandbox, identity, model, memory, grounding, tools, timeline compaction, knobs. Consumer agents compose on top with system prompts, gates, continuation logic, and specialized tools.

## The Shared Base

Everything an agent needs, wired up as components:

| Layer | What It Provides |
|-------|-----------------|
| **Sandbox** | OS-level workspace isolation (seatbelt on macOS, bwrap on Linux) |
| **Identity** | `~/.tentickle/IDENTITY.md` — the agent's self-authored soul document |
| **Model** | Dynamic multi-provider selection (OpenAI, Google, Apple) |
| **Memory** | Per-project persistent memory the agent reads and writes each turn |
| **Entities** | People, orgs, projects — profiles the agent maintains over time |
| **Rules** | Layered rules (global + project-level) with override semantics |
| **Skills** | Discovered `SKILL.md` files from project and global directories |
| **Timeline** | Tiered compaction — current execution at full fidelity, older messages collapsed |
| **Tools** | Shell, file I/O, glob, grep, task list, spawn, explore |

## Verification Gates

The coding agent doesn't just make changes and walk away. Gates are named checkpoints that block the model from completing until cleared:

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

Three states: **inactive** (default), **active** (blocking, instructions visible), **deferred** (blocking but silent — un-defers at exit). The framework provides the gate. The model provides the intelligence.

## Data Directory

Tentickle stores persistent state in `~/.tentickle/`:

```
~/.tentickle/
├── IDENTITY.md              # Agent's self-authored identity
├── settings.json            # Global settings
├── user/                    # Owner profile
├── entities/                # Entity profiles
├── rules/                   # Global rules
├── skills/                  # Global skills
└── projects/
    └── {workspace-slug}/
        ├── MEMORY.md        # Per-project memory
        └── rules/           # Project-specific rules
```

The agent navigates this via standard file tools. No special APIs — `read_file`, `write_file`, `glob`. The filesystem is the interface.

<div class="cta-buttons">
  <a href="/tentickle/docs/getting-started" class="cta-button primary">Get Started</a>
  <a href="https://github.com/agenticklabs/tentickle" class="cta-button secondary">View on GitHub</a>
</div>

</div>

<style>
.content-section {
  max-width: 1152px;
  margin: 0 auto;
  padding: 2rem 0;
}

.content-section h2 {
  font-size: 1.8rem;
  margin-top: 3rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 0.5rem;
}

.content-section h3 {
  font-size: 1.3rem;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: var(--vp-c-brand-1);
}

.code-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin: 1.5rem 0;
}

@media (max-width: 768px) {
  .code-compare {
    grid-template-columns: 1fr;
  }
}

.code-block {
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  padding: 1rem;
}

.code-block h3 {
  margin-top: 0;
  font-size: 1rem;
  opacity: 0.8;
}

.cta-buttons {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
  margin-bottom: 2rem;
}

.cta-button {
  display: inline-block;
  padding: 0.75rem 2rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 1rem;
  text-decoration: none;
  transition: opacity 0.2s;
}

.cta-button:hover {
  opacity: 0.85;
}

.cta-button.primary {
  background: var(--vp-c-brand-1);
  color: white;
}

.cta-button.secondary {
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}
</style>
