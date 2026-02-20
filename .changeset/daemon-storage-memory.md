---
"@tentickle/agent": minor
"@tentickle/cli": minor
"@tentickle/coding": minor
"@tentickle/main": minor
"@tentickle/memory": minor
"@tentickle/storage": minor
"@tentickle/tools": minor
"@tentickle/tui": minor
---

feat: daemon mode, package extraction, session persistence

- Extract `@tentickle/tui` and `@tentickle/cli` from agents
- Extract `@tentickle/storage` and `@tentickle/memory` from agent
- Daemon mode: background gateway with Unix socket TUI connection
- Session persistence: SQLite storage with message restoration
- CI: strip local dev overrides for npm resolution, bump to node 24
