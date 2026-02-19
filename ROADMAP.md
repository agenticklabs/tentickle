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
- [ ] Streaming message display — token-by-token response, not "Thinking..."
- [ ] Session persistence — save/resume conversations across restarts
- [ ] Unified execution tree — compose tool + spawn indicators via originCallId

## Phase 4: Agent Intelligence (In Progress)

- [x] Planning mode — task_list with plan/start/complete
- [x] Auto-continuation — useContinuation while tasks incomplete (max 50)
- [x] Sub-agent delegation — spawn tool for concurrent sub-tasks
- [x] Explore tool — spawn sub-agent for open-ended research
- [x] Knobs — expandable timeline, set_knob with name/group
- [ ] Verification loops — auto-run tests/typecheck after edits
- [ ] Error recovery — detect repeated failures, suggest alternatives
- [ ] Task dependencies — blocking, parallel execution hints

## Phase 5: Memory & Persistent Storage

Replace blob-per-session with normalized SQLite. Every session is a group chat.
Messages, entities, and memories are queryable. Forkable sessions with timeline
inheritance. Media pipeline for searchable attachments. Recall tools backed by
FTS5 search and spawned retrieval agents.

Full schema: `plans/memory-storage-schema.md`

### Tier 1 — Foundation (enables everything else)

- [ ] Migration system — numbered SQL files, `schema_migrations` table, checksum
      verification, forward-only, transaction-per-migration. Initial schema = 001.
- [ ] Normalized SQLite schema — sessions, participants, messages, content_blocks,
      events, session_state. Replace JSON blob snapshots.
- [ ] Media directory — `~/.tentickle/media/`, deduplicated by content hash.
      Media table with provenance tracking.
- [ ] Write path — new sessions write to normalized tables. Timeline assembled
      from queries, not deserialized blobs.
- [ ] Entity migration — move `~/.tentickle/entities/*.md` into `entities` table.
      `EntityAwareness` reads from DB.

### Tier 2 — Recall tools

- [ ] `recall(query)` — single-pass search. One spawned haiku agent searches
      memories_fts + messages_fts + entities_fts. Returns curated summary.
- [ ] `deep_recall(query)` — fan-out search. Partitions history by time/session,
      spawns N haiku agents in parallel, merges results. Depth limit: 2.
- [ ] `remember(topic, content, tags?)` — append-only memory log. Time-decayed
      relevance. Lineage tracking for concept evolution.
- [ ] Append-only memories — never update, only append. Time decay ranking.
      Evolution queries ("what did we believe about X at time T?").

### Tier 3 — Forkable sessions

- [ ] `session_type = 'fork'` with `fork_after_message_id`
- [ ] `WITH RECURSIVE` timeline assembly across fork chains
- [ ] Fork UI in TUI — branch indicator, parent reference
- [ ] Spawn sessions as children — `session_type = 'spawn'`, no timeline inheritance

### Tier 4 — Knowledge graph

- [ ] Entity extraction middleware — `tool.run` middleware on `remember` tool.
      Fast structured-output call (haiku) extracts entities + relationships
      from memory content. Synchronous, auditable, no background jobs.
- [ ] `entity_relationships` table — typed edges with provenance and confidence.
      Graph traversal via self-joins and `WITH RECURSIVE`.
- [ ] Graph-aware recall — recall tools can traverse entity relationships to
      find contextually relevant knowledge (2-hop max).

### Tier 5 — Media pipeline

- [ ] Ingest: hash, dedup, store, insert media row
- [ ] Thumbnails: resize images for LLM ingestion (token optimization)
- [ ] VLM descriptions: local vision model describes images/documents for
      searchability via `media_fts`
- [ ] Speech-to-text: transcribe audio/video for searchability
- [ ] All async — doesn't block conversation

## Phase 6: Packaging & Distribution

Ship `tentickle` as an installable CLI. Users should never need to clone agentick.

- [x] `packages/tentickle/` — umbrella package, re-exports from `@tentickle/*`
- [ ] CLI binary — `npx tentickle` launches TUI in cwd
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

### Recently contributed upstream

- Spawn event bubbling (spawn_start/spawn_end, child event forwarding)
- tool_result_start lifecycle event
- Confirmation routing through spawn tree
- originCallId on SpawnStartEvent
- Confirmation text input in default Chat
- SpawnIndicator TUI component
- ToolCallIndicator 3-state update
- `audience` tool property (replaced `commandOnly`)
- `dispatch` session method (replaced `dispatchCommand`)
- `mapChunk` array return support (Grok streaming fix)
- `<Tool>` handler Procedure wrapping (`tool-procedure.ts`)

### Upstream work needed

- **user-audience → SlashCommand bridge** — `useUserTools()` hook in `@agentick/tui`
  that auto-generates slash commands from user-audience tools. Proof case: `add-dir`.
- **dispatch on all transports** — currently local-only. Needs gateway, WebSocket, HTTP.
- **Dynamic command discovery** — stream available commands via CompiledEvent.
