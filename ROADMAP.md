# Roadmap

## Phase 1: Foundation (Complete)

Working coding agent: read, write, edit, run commands in a sandboxed workspace.

- [x] Project structure — pnpm workspaces, turbo, typescript
- [x] Workspace overrides — link agentick packages from sibling repo
- [x] `@tentickle/tools` — Glob and Grep tool components
- [x] `@tentickle/coding` — Agent composition with sandbox tools
- [x] Custom TUI — banner, footer, attachments, file completions, task list
- [x] Workspace configuration — CWD as sandbox workspace
- [x] Running end-to-end — agent handles real coding tasks

## Phase 2: Context Engineering (Mostly Complete)

The agent runs but struggles with weaker models. Context management is where
the biggest capability gains live.

- [x] Structured system prompt — `<System>` + `<Section>` with "ACT don't narrate" rules
- [x] Workspace grounding — package.json, scripts, git branch as `<Grounding>`
- [x] Smart timeline — `<EnhancedTimeline>` with tiered compaction, expandable
      via `set_knob`, role-aware summaries (no ICL corruption)
- [x] Expandables — collapsed/collapsedName/collapsedGroup on sections, messages,
      content blocks. set_knob with name/group expansion.
- [x] Memory — persistent MEMORY.md, re-reads after every tick
- [x] Project conventions — reads CLAUDE.md / AGENTS.md from workspace root
- [ ] Tool description refinement — tune descriptions for fewer misuse patterns
- [ ] Context budget awareness — `useContextInfo` to compress proactively

## Phase 3: TUI Polish (Mostly Complete)

- [x] Rich text input — readline-quality editing, word nav, history
- [x] Rendering system — per-type content block rendering, markdown, theme
- [x] Slash command completion — popup, `/` trigger, arrow nav, fuzzy filter
- [x] Execution steering — queue mode, messages during execution
- [x] File/dir completions — tab-complete paths in input
- [x] Attachments — `/attach`, attachment strip, image/document support
- [x] Diff rendering — DiffView in tool confirmation prompt
- [x] Tool call indicators — 3-state (queued/executing/done)
- [x] Confirmation policy — auto-approve memory writes, prompt otherwise
- [x] SpawnIndicator — wired next to ToolCallIndicator
- [x] Confirmation text input — Y/N/A shortcuts, text feedback on Enter
- [x] Session persistence — save/resume conversations across restarts
- [-] Streaming message display — framework supports streaming, TUI renders
  thinking indicator but not true token-by-token
- [ ] Unified execution tree — compose tool + spawn indicators via originCallId

## Phase 4: Agent Intelligence (In Progress)

- [x] Planning mode — task_list with plan/start/complete
- [x] Auto-continuation — useContinuation while tasks incomplete (max 50)
- [x] Sub-agent delegation — spawn tool for concurrent sub-tasks
- [x] Explore tool — spawn sub-agent for open-ended research
- [x] Knobs — expandable timeline, set_knob with name/group
- [x] Delegation system — dispatch mode, supervised mode, follow-up messages
- [x] Confirmation routing — pipes through delegation tree (71e4c32)
- [x] Job management — sessions ARE jobs (2773e57), inspect/approve/cancel
- [x] Session graph topology — collapsed 9 tools to 5 (3 graph ops + 1 query + 1 shell)
- [ ] Delegation hardening — sandbox `run_verification` (bypasses sandbox today),
      authorization boundary on `send_session` (any session ID accepted today),
      ownership validation on `sessions` inspect/close, `requiresConfirmation` on
      high-stakes tools, inbox message framing (role:"user" enables prompt injection)
- [ ] Verification loops — auto-run tests/typecheck after edits
- [ ] Error recovery — detect repeated failures, suggest alternatives
- [ ] Task dependencies — blocking, parallel execution hints

Session graph done — delegation collapsed from ~770 LOC (9 tools, 4 files) to
~470 LOC (5 tools, 1 file). Roles still derived from metadata (not graph position)
but the tool surface maps cleanly to graph operations.

## Phase 5: Memory & Persistent Storage

SQLite-backed memory and session persistence. Memory is a tentickle library
built on `createTool` — not a framework feature. Session store uses the same
SQLite database with forward-only migrations.

### Done

- [x] TentickleMemory — SQLite + FTS5, createTool-based library
- [x] remember/recall tools — append-only writes, time-decay ranking, RRF
- [x] Namespace isolation — per-workspace or per-user
- [x] Dedup — configurable cosine similarity threshold
- [x] TentickleSessionStore — SQLite session metadata + snapshots
- [x] Migration system — numbered SQL files, forward-only
- [x] Delegation types — session_type column (delegation/supervision)

### Next

- [ ] Recall agent — spawned haiku agent for multi-source search
- [ ] Forkable sessions — fork_after_message_id, WITH RECURSIVE assembly
- [ ] Entity extraction — memory middleware, structured-output
- [ ] Media pipeline — ingest, thumbnails, VLM descriptions (async)

## Phase 6: Packaging & Distribution

Ship `tentickle` as an installable CLI. Users should never need to clone agentick.

- [x] `packages/tentickle/` — umbrella package, re-exports from `@tentickle/*`
- [-] CLI binary — entry point exists, not polished
- [ ] Argument parsing — `--model`, `--workspace`, `--verbose`
- [ ] `tentickle init` — scaffold .env, project conventions
- [ ] `tentickle doctor` — verify env, API keys, sandbox support
- [ ] Publish to npm — `tentickle` + `@tentickle/coding` + `@tentickle/tools`
- [ ] Decouple from agentick sibling — consume published `@agentick/*` packages

## Phase 7: OS-Level Isolation (Opt-In)

Dedicated OS user for production deployments. Default: run as current user
(zero friction). Opt-in via `tentickle init --system-user`.

- [ ] `tentickle init --system-user` — create dedicated `tentickle` OS user,
      set up home directory, file permissions (rwx------), platform detection
- [ ] macOS support — `sysadminctl` / `dscl` user creation, ACLs for workspace
- [ ] Linux support — `useradd`, `setfacl` for workspace access
- [ ] Gateway runs as bot user — network-facing process isolated from human account
- [ ] Data at rest protection — SQLite DB, media, memories owned by bot user
- [ ] Workspace access — ACL grants bot user read/write to project directory only
- [ ] Fallback — graceful degradation if running as current user (no permission changes)

## Phase 8: Specialized Agents

Extract patterns and build focused agents that compose with the coding agent.

- [x] Agent composition — spawn, createSpawnTool, event bubbling
- [x] Per-instance task stores — spawned agents get isolated state
- [ ] Review agent — code review, PR analysis, quality gates
- [ ] Test agent — test generation, coverage analysis
- [ ] Debug agent — reproduce bugs, trace issues, bisect failures

## Ongoing: Framework Co-Development

Every framework gap gets an entry in `AGENTS.md`. Fix upstream, don't work around.

### Recently contributed upstream

- Gateway protocol formalization (schema discovery, error codes, PROTOCOL.md)
- Gateway configuration system (ConfigStore, schema registry, env/secret interpolation)
- Gates (useGate — knob-backed continuation conditions)
- Knobs provider pattern (3 rendering modes, group dispatch)
- Expandable content blocks (collapsed/collapsedName/collapsedGroup)
- Content block JSX components (Text, Image, Document, Audio, Video, Code, Json)
- Session.pushEvent() — external event injection
- Session.getToolDefinitions() — tool catalog with audience
- Unix socket transport + shared factory pattern
- Gateway plugin system (runtime use/remove, PluginContext)
- Embedding support on adapters (openai, google, huggingface, apple)
- @agentick/secrets — platform-native secret storage (Keychain, libsecret)
- Audience + dispatch model (replaces commandOnly/dispatchCommand)
- Spawn event bubbling (spawn_start/spawn_end, child event forwarding)
- tool_result_start lifecycle event
- Confirmation routing through spawn tree
- useComState fix (EventEmitter subscription)
- provider_request type guard fix
- Streaming event type arrays (MODEL_EVENT_TYPES etc.)
- mapChunk array return support

### Upstream work needed

- **user-audience → SlashCommand bridge** — `useUserTools()` hook in `@agentick/tui`
  that auto-generates slash commands from user-audience tools. Proof case: `add-dir`.
- **dispatch on all transports** — currently local-only. Needs gateway, WebSocket, HTTP.
- **Dynamic command discovery** — stream available commands via CompiledEvent.
- **Session graph as first-class** — `parentSessionId`, `notifyParent()`, `app.receive(id, msg)`
  landed (d9f2cce). Remaining: `pipeConfirmations` as core utility (duplicates
  spawn's confirmation routing), recursive `closeTree` for deep topologies.

### Plugin Architecture (Core Extensibility)

Agentick's integration points must follow a **plugin pattern** where external
code wires itself into the framework via `{ install(target): void }`. Plugins
control their own lifecycle, persistence strategy, and cleanup. The framework
provides touch points (events, state accessors); plugins subscribe and manage
themselves.

Full design: `../agentick/plans/session-store-plugin.md`

**Phase 1 — Session Store Plugin** (HIGH — blocks persistence work):

- [ ] `SessionStorePlugin` type: `install(session)` + `load/list/has/delete`
- [ ] `MemoryStore()` function replaces `MemorySessionStore` class
- [ ] `SqliteStore()` function replaces `SqliteSessionStore`
- [ ] Kill `_persistCallback`, `setPersistCallback()`, `SessionRegistry.persist()`
- [ ] Kill `onBeforePersist/onAfterPersist/onBeforeRestore/onAfterRestore` from AppOptions
- [ ] Convert `TentickleSessionStore` to plugin (self-wiring incremental persistence)

**Phase 2 — DevTools Plugin** (MEDIUM — kills global singleton):

- [ ] `DevToolsPlugin` type with per-session install
- [ ] Extract devtools emission from SessionImpl
- [ ] Replace `devTools: boolean` with `devTools?: DevToolsPlugin`

**Phase 3 — Recording Plugin** (MEDIUM-LOW — slims SessionImpl):

- [ ] Extract `captureTickSnapshot()` + recording state from SessionImpl
- [ ] Replace `recording: RecordingMode` with `recording?: RecordingPlugin`

**Phase 4 — Scheduler Plugin** (MEDIUM — kills global binding):

- [ ] Refactor `CronService` to return a plugin with `.Tool` for component tree
- [ ] Kill `bindSchedulerStore()` / `getSchedulerStore()` globals

**Not plugins** (correct as-is): Model Adapter (handler-bag), ExecutionRunner
(handler-bag+lifecycle), Sandbox Provider (factory), Middleware (AOP),
Guardrails (middleware), Secret Store (service), Transport (infrastructure).

### OAuth & Scopes (Gateway Auth)

All primitives exist — zero framework changes needed.

- [ ] `UserContext.scopes` — add `scopes?: string[]` to kernel's `UserContext`
- [ ] OAuth gateway plugin — `authenticate()` validates token, returns user
      with scopes from OAuth provider (Google, GitHub, etc.)
- [ ] Scope guard factory — `createScopeGuard(required: string[])` using
      `Context.get().user?.scopes`, same pattern as `createRoleGuardMiddleware`
- [ ] Per-tool scope binding — `tool.run.use(scopeGuard)` at mount time,
      e.g. `shell` requires `scope:exec`, `write_file` requires `scope:write`
- [ ] Session-level scope propagation — gateway already passes `UserContext`
      into `Context.create()` at `invokeMethod` (gateway.ts:1624). Sessions
      created within that context inherit scopes automatically.

Architecture: gateway plugin (boundary) → UserContext (threading) → guards
(enforcement). No procedure middleware needed.
