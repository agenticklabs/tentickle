# @tentickle/memory

## 0.1.0

### Minor Changes

- 176841b: feat: daemon mode, package extraction, session persistence

  - Extract `@tentickle/tui` and `@tentickle/cli` from agents
  - Extract `@tentickle/storage` and `@tentickle/memory` from agent
  - Daemon mode: background gateway with Unix socket TUI connection
  - Session persistence: SQLite storage with message restoration
  - CI: strip local dev overrides for npm resolution, bump to node 24
