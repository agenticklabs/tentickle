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

## Phase 5: Packaging & Distribution

Ship `tentickle` as an installable CLI. Users should never need to clone agentick.

- [x] `packages/tentickle/` — umbrella package, re-exports from `@tentickle/*`
- [ ] CLI binary — `npx tentickle` launches TUI in cwd
- [ ] Argument parsing — `--model`, `--workspace`, `--verbose`
- [ ] `tentickle init` — scaffold .env, project conventions
- [ ] `tentickle doctor` — verify env, API keys, sandbox support
- [ ] Publish to npm — `tentickle` + `@tentickle/coding` + `@tentickle/tools`
- [ ] Decouple from agentick sibling — consume published `@agentick/*` packages

## Phase 6: Specialized Agents

Extract patterns and build focused agents that compose with the coding agent.

- [x] Agent composition — spawn, createSpawnTool, event bubbling
- [x] Per-instance task stores — spawned agents get isolated state
- [ ] Review agent — code review, PR analysis, quality gates
- [ ] Test agent — test generation, coverage analysis
- [ ] Debug agent — reproduce bugs, trace issues, bisect failures

## Ongoing: Framework Co-Development

Every framework gap gets an entry in `AGENTS.md`. Fix upstream, don't work around.

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

### Upstream work needed

- **user-audience → SlashCommand bridge** — `useUserTools()` hook in `@agentick/tui`
  that auto-generates slash commands from user-audience tools. Proof case: `add-dir`.
- **dispatch on all transports** — currently local-only. Needs gateway, WebSocket, HTTP.
- **Dynamic command discovery** — stream available commands via CompiledEvent.
