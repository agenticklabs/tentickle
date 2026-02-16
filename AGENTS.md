# Tentickle — Agent Architecture & Mission

## Mission

Build a collection of specialized, composable agents that excel at fundamental
software engineering tasks. Start with a coding agent. Use this project as the
proving ground for the agentick framework — every agent we build stress-tests
the framework and drives it forward.

## Philosophy

### Composition Over Monoliths

Don't build one giant agent that does everything. Build small, focused agents
that compose. A coding agent is not one thing — it's file reading + code
understanding + editing + testing + planning + review, each a distinct
capability that can be developed, tested, and improved independently.

In agentick terms: each capability is a component or a set of components. The
coding agent is a composition of those components in a JSX tree. Swap one out,
add another, conditionally render based on task type.

### The Framework Is The Product Too

When building agents reveals a deficiency in agentick — a missing hook, an
awkward API, a performance bottleneck — that's not a problem to work around.
That's a feature request. Fix it upstream. The agents we build here should
push the framework to be better.

### No Magic, No Abstraction Theater

Every layer must earn its existence. If a tool wrapper doesn't add real value
over the raw `createTool` call, delete it. If an "agent framework" layer just
re-exports agentick with different names, it shouldn't exist. The framework
already provides the right primitives — use them directly.

## Agent Architecture

### Coding Agent (`@tentickle/coding`)

The coding agent operates in a tick loop: receive task → read context → make
changes → verify. Built on `@agentick/sandbox` for workspace isolation.

**Sandbox tools** (from `@agentick/sandbox`):

- `Shell` — run commands in the workspace
- `ReadFile` — read file contents
- `WriteFile` — create or overwrite files
- `EditFile` — surgical edits with 3-level matching (exact → normalized → indent-adjusted)

**Search tools** (from `@tentickle/tools`):

- `Glob` — find files by pattern
- `Grep` — search file contents by regex

**Agent composition** (`agents/coding/src/agent.tsx`):

```tsx
<Sandbox provider={localProvider()} workspace={workspace}>
  <System>{systemPrompt}</System>
  <ReadFile />
  <WriteFile />
  <EditFile />
  <Shell />
  <Glob />
  <Grep />
  <Timeline />
</Sandbox>
```

**TUI** (`agents/coding/src/tui.tsx`):
Custom terminal UI built on `@agentick/tui` components. Header, message list,
streaming response, tool indicators, input bar.

### Future Agents

As the coding agent matures, extract patterns into reusable components and
build specialized agents:

- **Review agent** — code review, PR analysis, quality gates.
- **Test agent** — test generation, coverage analysis, mutation testing.
- **Debug agent** — reproduce bugs, trace issues, bisect failures.
- **Refactor agent** — large-scale code transformations, migration assistance.

Each shares the same tool components, session infrastructure, and TUI — just
different compositions in different `agents/` packages.

## Component Design

### Tools

Tools are the agent's hands. Each tool should:

- Do one thing well.
- Return structured results (content blocks, not strings).
- Render relevant state back into context via `render` when useful.
- Be independently testable with `createTestAdapter`.

### Context Components

Context components are the agent's eyes. They control what the model sees:

- `<Section>` for persistent state (file contents, project structure).
- `<Ephemeral>` for transient context (current task, recent changes).
- `<Grounding>` for reference material (docs, examples).
- Custom `<Timeline>` render functions for conversation management.

### Hooks

Hooks are the agent's brain. They control behavior between ticks:

- `useContinuation` — when to stop.
- `useOnTickEnd` — verify, validate, decide next action.
- `useKnob` — model-adjustable parameters.
- `useSignal` / `useComState` — reactive state across components.

## TUI

The terminal interface is built on `@agentick/tui`. It should be:

- Clean and functional. Not flashy.
- Show streaming responses, tool calls, context utilization.
- Support local (in-process) and remote (SSE) connections.
- Pluggable — custom UI components for specialized agent views.

## Framework Gaps

Track agentick limitations discovered during development. Each entry describes
the gap, the desired behavior, and whether it's been addressed.

### Gap 1: Glob/Grep tools not in sandbox

**Status:** Open
**Description:** `@agentick/sandbox` provides Shell, ReadFile, WriteFile,
EditFile — but not Glob or Grep. These are fundamental file system operations
that every coding agent needs. Currently implemented in `@tentickle/tools`.
**Desired:** Glob and Grep should be built-in sandbox tools, automatically
scoped to the workspace like the other file tools.
**Action:** Build them here, prove the API, then PR upstream.

### Gap 2: useSandbox() availability in tool handlers

**Status:** Resolved
**Description:** `useSandbox()` is a React hook — it works during render but
not inside handler functions. The sandbox tools use `createTool`'s `use` option:
`use: () => ({ sandbox: useSandbox() })`. This runs during render and injects
the sandbox as `deps` into the handler. Our Glob/Grep tools now use this pattern.

### Gap 3: Cross-repo React singleton with link: dependencies

**Status:** Workaround in place
**Description:** When agentick packages are linked via `pnpm.overrides` with
`link:`, React resolves to two different instances — one in tentickle's
`node_modules`, one in agentick's. This breaks hooks (null dispatcher).
React must be a singleton, but `link:` dependencies resolve their own deps
from their source location, not the consumer's.
**Workaround:** Override `react` in tentickle to point to agentick's copy:
`"react": "link:../agentick/node_modules/.pnpm/react@19.2.4/node_modules/react"`
**Fragility:** This path is version-specific and depends on pnpm's internal
store layout. If agentick upgrades React, this override must be updated manually.
**Proper fix:** Either a single workspace encompassing both repos, or framework-
level guidance for cross-repo development with linked dependencies.

### Gap 4: appOptions.model skipped for fromEngineState

**Status:** Fixed upstream
**Description:** When a model is passed via `createApp(Component, { model })` but
no `<Model>` JSX component is rendered, `compileTick()` only checked
`this.ctx.getModel()` (COM model) for the `fromEngineState` transformation.
Since the COM model is only set by `<Model>` components, `fromEngineState` never
ran. The raw `COMInput` (with `timeline`, not `messages`) was passed directly to
the model adapter, which expects `ModelInput.messages`.
**Fix:** `compileTick()` now falls back to `this.appOptions.model` when the COM
model is unset: `(this.ctx.getModel() ?? this.appOptions.model)`. JSX-rendered
`<Model>` still takes precedence.

### Gap 5: ExecutionEndEvent.output is untyped

**Status:** Open
**Description:** `ExecutionEndEvent.output` is typed as `unknown` in
`@agentick/shared/streaming.ts`. In practice, session.ts sends the completed
COMInput which has a `.timeline` property (array of timeline entries). The TUI
hook needs `output.timeline` for the fallback path but must cast through
`unknown`, losing type safety.
**Desired:** `ExecutionEndEvent.output` should be a proper type (or generic)
that includes `timeline?: TimelineEntry[]`. Alternatively, the delta path
(`newTimelineEntries`) should be the only path and the fallback removed.
**Action:** Fix the type in `@agentick/shared` and remove the cast in the
TUI hook.

### Gap 6: commandOnly tools don't bridge to TUI slash commands

**Status:** Open
**Description:** `commandOnly` tools (registered in the JSX tree via
`createTool({ commandOnly: true })`) and TUI `SlashCommand`s duplicate metadata
— name, description, aliases. A commandOnly tool like `add-dir` must be defined
as a `createTool` in the agent AND separately wired as a slash command in the
TUI, with the TUI handler calling `accessor.dispatchCommand()`. The shapes are
close but not identical: SlashCommands take raw `args: string`, tools take
structured `input: ZodSchema`.
**Desired:** A `useCommandOnlyTools({ accessor })` hook in `@agentick/tui` that
introspects the session's commandOnly tools and auto-generates `SlashCommand`
entries from them. The bridge would: query session for commandOnly tool metadata,
generate SlashCommands where handler calls `dispatchCommand`, parse `args` string
using the tool's Zod schema, and format `ContentBlock[]` results via `extractText`.
**Note:** Client-only commands like `attach` (pure TUI state manipulation) are
correctly NOT commandOnly tools — they stay as plain SlashCommands.
**Action:** Build the bridge hook in `@agentick/tui`, prove with tentickle's
`add-dir` command, then generalize.

## Package Map

| Package             | Purpose                    | Status |
| ------------------- | -------------------------- | ------ |
| `@tentickle/tools`  | Glob, Grep tool components | Active |
| `@tentickle/coding` | Coding agent + TUI + CLI   | Active |

## Development Priorities

See `ROADMAP.md` for the full phased plan.

1. Get the agent running end-to-end.
2. Refine tools and system prompt through real usage.
3. Build TUI features as needed.
4. Push framework improvements upstream.
