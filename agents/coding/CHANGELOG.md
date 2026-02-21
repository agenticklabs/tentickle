# @tentickle/coding

## 0.1.0

### Minor Changes

- 176841b: feat: daemon mode, package extraction, session persistence

  - Extract `@tentickle/tui` and `@tentickle/cli` from agents
  - Extract `@tentickle/storage` and `@tentickle/memory` from agent
  - Daemon mode: background gateway with Unix socket TUI connection
  - Session persistence: SQLite storage with message restoration
  - CI: strip local dev overrides for npm resolution, bump to node 24

### Patch Changes

- Updated dependencies [176841b]
  - @tentickle/agent@0.1.0
  - @tentickle/tui@0.1.0

## 0.0.3

### Patch Changes

- Fix @agentick/_ dependency ranges — replace wildcard "_" with pinned "^0.8.0"
- Updated dependencies
  - @tentickle/agent@0.0.3

## 0.0.2

### Patch Changes

- Extract shared agent base, add main agent, verification gates

  - New `@tentickle/agent` package: shared `<TentickleAgent>` base component with identity, memory, grounding, entities, user profiles, rules, skills, settings, timeline compaction, and tool factories.
  - New `@tentickle/main` agent: personal orchestration agent with entity awareness and human context.
  - `@tentickle/coding` slimmed to coding-specific behavior (system prompt, verification gate, conventions) on the shared base.
  - Verification gates (`useGate`): knob-backed continuation conditions that block the model from completing until cleared.
  - Layered settings system: global → project → project-local.
  - Data directory (`~/.tentickle/`) for persistent identity, memory, entities, rules, and skills.

- Updated dependencies
  - @tentickle/agent@0.0.2
