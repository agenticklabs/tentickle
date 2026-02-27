# Kernel Architecture — Session Orchestration Model

Raw design sketch. Half-riff, half-architecture. Emerged from a late-night
session thinking about fire-and-forget jobs, event-role messages, and what
the main session actually IS.

---

## The Core Insight

The main session doesn't do work. It manages processes that do work.

Like an OS kernel: it never runs application code. It manages the process
table, handles IPC, routes interrupts, and provides a syscall interface.
The intelligence is in the shells (which interpret user intent) and the
workers (which execute tasks). The kernel is a modelless dispatcher.

## The UNIX Analogy

| OS Concept        | Agent Equivalent                                      |
| ----------------- | ----------------------------------------------------- |
| Kernel            | Main session — orchestration hub, no model calls      |
| Process table     | Session metadata queries (not a separate store)       |
| Processes         | Worker sessions — coding, research, analysis tasks    |
| TTY / terminals   | Shell sessions — per-conversation context             |
| fork/exec         | Delegate tool → kernel spawns worker                  |
| Signals / IPC     | Event-role messages flowing along session graph edges |
| kill / wait       | Cancel / inspect tools                                |
| Interrupts        | Cron, heartbeat, connector events                     |
| /proc             | Session graph state                                   |
| dmesg / syslog    | Timeline (the running log)                            |
| Shared memory     | Artifacts / cross-session data store                  |
| Pipes             | Programmatic data flow between workers                |
| Syscall interface | The small set of tools exposed to shells              |

## Architecture Diagram

```
                    [Kernel Session]              ← modelless dispatcher
                   /    |    |      \
           [TUI Shell] [TG:Bob] [TG:Alice]       ← conversation sessions
                        |
                    [Worker Pool]                  ← task sessions
                    [Worker: refactor-auth]
                    [Worker: write-tests]
                    [Worker: research-api]
```

Key properties:

- **TUI is not special.** It gets its own shell session, just like Telegram.
  The kernel has no direct user I/O.
- **Connectors are I/O drivers**, not sessions. They create shell sessions
  for each conversation (like a TTY driver spawns shells).
- **Workers are disposable.** They spin up, do work, emit events, terminate.
  Their context windows are purpose-built and expendable.
- **The kernel is long-lived and lean.** No file contents, no tool output,
  no code. Just the process table and event routing.

## Event Types (The Syscall Table)

The kernel is modelless. Events ARE the entire API.

### Shell → Kernel

| Event      | Payload                                               | Kernel Action                        |
| ---------- | ----------------------------------------------------- | ------------------------------------ |
| `delegate` | task, context, mode (inline/background), contextRefs? | Spawn worker, track, ack             |
| `cancel`   | taskId                                                | Abort worker, clean up, notify shell |
| `query`    | filter (status, process list, specific task)          | Read process table, respond          |
| `confirm`  | toolUseId, approved, always                           | Forward to worker                    |

### Worker → Kernel

| Event             | Payload                      | Kernel Action                                           |
| ----------------- | ---------------------------- | ------------------------------------------------------- |
| `complete`        | taskId, result summary       | Update state, notify originating shell, write to memory |
| `error`           | taskId, error details        | Update state, notify originating shell, write to memory |
| `progress`        | taskId, message              | Forward to originating shell (throttled?)               |
| `escalate`        | taskId, question, context    | Forward to originating shell as prompt                  |
| `confirm_request` | toolUseId, message, metadata | Forward to originating shell for user approval          |

### System → Kernel

| Event     | Payload                                    | Kernel Action                      |
| --------- | ------------------------------------------ | ---------------------------------- |
| `trigger` | source (cron/heartbeat/connector), details | Evaluate rules, maybe spawn worker |

10 event types. The dispatch loop is ~80 lines of code.

## Process Table — It's a View, Not a Store

**There is no separate process table.** The session store already tracks
sessions. The "process table" is a query over session metadata.

```typescript
// Not a class. Not a store. A query.
function listWorkers(app: App) {
  return app.sessions
    .filter((s) => s.metadata.type === "worker")
    .map((s) => ({
      id: s.id,
      origin: s.metadata.origin, // which shell spawned this
      task: s.metadata.task, // what was requested
      mode: s.metadata.mode, // inline | background
      state: s.state, // session state IS process state
    }));
}
```

When a shell queries status:

```
TASKS
  #1  refactor-auth     running   3m    background
  #2  write-tests       complete  1m    background
  #3  check-package     waiting   10s   inline
```

Worker state transitions:

```
spawn → running → complete
                → error
                → cancelled
       → waiting → running    (confirmation resolved)
                 → cancelled
```

The session IS the process. No parallel data structure. No JobStore. When a
worker session completes, its state change IS the process table update.

What agentick needs to provide (if it doesn't already):

- Session metadata (tags, key-value pairs set at creation)
- Session graph queries (children of session X, parent of session Y)
- These are legitimate framework primitives, not kernel concepts.

## Delegation Modes

One tool, one parameter:

```
delegate({ task: "refactor auth module", mode: "background" })
→ "On it. I'll let you know when it's done."

delegate({ task: "what's in package.json?", mode: "inline" })
→ [shell holds promise, waits for result] → responds to user
```

**Inline mode flow:**

1. Shell sends `delegate` with `mode: "inline"`
2. Kernel spawns, tracks, sends `ack` with taskId
3. Shell holds pending promise
4. Worker runs, emits `complete`
5. Kernel routes `complete` to shell
6. Shell's promise resolves, responds to user

**Background mode flow:**

1. Shell sends `delegate` with `mode: "background"`
2. Kernel spawns, tracks, sends `ack`
3. Shell responds "on it" and continues conversation
4. Worker `complete` arrives later as notification

## Shell Agent Design

All shells share a foundational identity. Per-shell additions are thin.

```tsx
function ShellAgent() {
  return (
    <System>
      <Identity /> {/* shared: who am I, how I behave */}
      <ShellContext /> {/* per-shell: TUI vs Telegram context */}
      <MemoryTools /> {/* cross-session memory read/write */}
      <DelegationTools /> {/* delegate, query, cancel → kernel events */}
      <Timeline />
    </System>
  );
}
```

**Shell tools (5 total):**

- `delegate(task, context, mode)` → taskId
- `query(filter?)` → process list
- `cancel(taskId)` → confirmation
- `memory_search(query)` → relevant memories
- `memory_write(key, content)` → stored

**No `read_file`. No `bash`. No `edit_file`. No `grep`.**

Those belong to workers. The shell model's intelligence goes into
decomposition and framing — understanding what the user wants and
turning it into well-specified delegations.

## Connectors

Connectors are I/O drivers, not sessions. They translate wire protocols
(Telegram API, iMessage, etc.) into session events. Each conversation
gets its own shell session.

```
Kernel
├── tty0        ← TUI (local console)
├── pts/0       ← Telegram: Bob
├── pts/1       ← Telegram: Alice
├── pts/2       ← iMessage: Sarah
│
├── [pid 1]     ← refactor-auth worker
├── [pid 2]     ← write-tests worker
└── [pid 3]     ← research-api worker
```

Cross-shell visibility comes through memory, not the process table.
Bob asks "what happened today?" → his shell queries memory, which has
everything regardless of which shell initiated it.

## Context Window Efficiency

The architecture is a context window optimization:

- **Shell sessions**: lean. Conversation + delegation tools + memory queries.
  No file contents, no grep results, no code. Fast and responsive.
- **Worker sessions**: purpose-built. Full tool sets, file contents, code
  context. Disposable — context window is expendable.
- **Kernel session**: trivial. No model calls. No context window at all.

A shell model deciding WHAT to delegate needs intelligence but not context.
A worker model doing the work needs context but not conversation history.
Separating these lets each be optimized for its role.

## Data Piping — Programmatic Cross-Session Data Flow

### The Problem

If the shell does inline queries to gather context before delegating real
work, that context either:

1. **Stays in the shell** — bloats the shell's context window
2. **Gets summarized** — game of telephone, lossy

### The Solution: Programmatic Pipes

Data flows between workers WITHOUT a model call interpreting it in transit.

**Mechanism 1: Spawn-time injection**

The kernel takes Worker A's result and injects it into Worker B's context
as grounding. No model call. The kernel wires the pipe.

```typescript
// Kernel dispatch — pure code, no model
const queryResult = await workerA.result;

const workerB = app.createSession({
  component: <CodingAgent />,
  grounding: [queryResult.content],  // injected directly
  metadata: { origin, task },
});
```

**Mechanism 2: Named artifacts (shared memory)**

Workers produce named artifacts. Other workers consume them. The kernel
references artifacts by name when spawning workers.

```typescript
// Worker A produces an artifact
session.artifact("auth-analysis", {
  files: ["src/auth.ts", "src/middleware.ts"],
  content: fileContents,
  summary: "JWT validation fails on expired tokens",
});

// Kernel spawns Worker B with artifact reference
spawn({ grounding: [artifact("auth-analysis")] });
```

**Key constraint: artifacts are NOT a framework primitive.** Per the existing
agentick plans (plans/agentic/artifacts.md), artifacts are a library using
the Provider pattern — components, hooks, context, tools. Same pattern as
todos, memory, or any managed collection.

The pipe mechanism should compose from existing agentick primitives:

- Session results (Worker A's output is stored on the session)
- Grounding injection (content passed at session creation)
- Channels (for real-time data flow between concurrent workers)

If sessions accept grounding as a creation parameter (or components accept
it as props), no new framework primitive is needed.

### Collapsible Tool Results

For cases where the shell DOES see intermediate results (inline queries),
tool results can carry a TTL for context window management:

```tsx
// Full content on tick 0, summary after 2 ticks
<Ephemeral ttl={2} summary="auth.ts: 142 lines, JWT middleware">
  {fullFileContent}
</Ephemeral>
```

Or as a tool render concern — tools decide their own decay policy:

```typescript
render(result, { tickAge }) {
  if (tickAge === 0) return result.fullContent;
  return `[query result: ${result.summary}]`;
}
```

Caching impact is minimal — one segment at the transition point.

## Orphaned Events

When a worker completes but the originating shell is gone (user closed TUI,
Telegram chat ended), the kernel writes the completion to cross-session
memory. Any future shell can retrieve it. Real-time notification is a
nice-to-have on top of the durable record.

## What Agentick Needs to Provide

Most primitives exist. One significant gap identified.

| Need                              | Agentick Primitive                                  | Status                                                   |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Session creation                  | `app.createSession()`                               | Exists                                                   |
| Session destruction               | `session.destroy()`                                 | Exists                                                   |
| Inter-session messaging           | Channels                                            | Exists                                                   |
| Session lifecycle observation     | Events                                              | Exists                                                   |
| Parent-child relationships        | `session.spawn()`                                   | Exists                                                   |
| Parent tracking                   | `session._parent`, `session._children`              | Exists (private)                                         |
| Session metadata                  | `session.metadata` (frozen, creation-time)          | **Done** — SessionOptions.metadata, snapshot persistence |
| Session graph queries             | `app.getSession(id)` (read-only, no activity touch) | **Done** — registry.peek(), App.getSession               |
| **Structural input on SendInput** | **See below**                                       | **MISSING — needs design**                               |

### Structural Primitives on SendInput (Framework Side Project)

**The gap:** `SendInput` currently only has `messages` (and `props`). When
spawning a worker, the only way to inject context is through `messages`
(semantically wrong — messages have roles, the user didn't say this) or
through component `props` (requires the component to explicitly handle it).

**The proposal:** Extend `SendInput` to support ALL structural JSX primitives
as data:

```typescript
interface SendInput {
  messages?: Message[]; // existing — timeline entries
  props?: Record<string, unknown>; // existing — component props

  // NEW: structural primitives as data
  grounding?: GroundingEntry[]; // → rendered as <Grounding> at compile
  system?: string | string[]; // → appended to system prompt
  sections?: SectionEntry[]; // → rendered as <Section> entries
  ephemeral?: EphemeralEntry[]; // → rendered as <Ephemeral> with config
  timeline?: Message[]; // → alias/sugar, same as messages?
}
```

**How it works:** These fields are collected at compile time and merged
into the COM state alongside JSX-rendered content. By default, they're
additive — JSX components compose with input-provided data. Open questions:

- **System**: append or prepend to JSX-rendered `<System>`?
- **Timeline/Messages**: only added if `<Timeline>` is not rendered? Or
  always? If `<Timeline>` is rendered, does it take over?
- **Grounding**: added to COM state, rendered as `<Grounding>` entries.
  Position, order, title from the entry config.
- **Ephemeral**: includes TTL config, position, etc.
- **Sections**: section id, audience, content.

**The principle:** JSX is the primary composition mechanism. SendInput
structural fields are the programmatic escape hatch for when you need to
inject context from CODE (kernel dispatch, pipe wiring, programmatic
orchestration) rather than from COMPONENTS.

JSX is additive with (or takes over from / overrides) SendInput fields.
The exact override semantics need design — probably:

- JSX always wins for system (JSX System IS the system prompt, SendInput
  system appends to it)
- Grounding, ephemeral, sections: SendInput entries merge with JSX entries
- Timeline/messages: if `<Timeline>` is rendered, it owns the messages;
  SendInput messages are additional entries

**Why this matters for the kernel architecture:** The kernel can spawn
workers with rich structured context without the component needing to know:

```typescript
// Kernel pipes Worker A's output into Worker B — no model call
session.spawn(CodingAgent, {
  messages: [{ role: "user", content: "Fix the auth bug" }],
  grounding: [
    {
      title: "Prior analysis",
      content: workerAResult.content,
    },
  ],
});
```

The CodingAgent component doesn't need a `context` prop. The grounding
appears in its context automatically. The kernel just wires the pipe.

**This is a framework-level change in agentick.** It's general-purpose —
any app benefits from programmatic context injection at send/spawn time.
Needs its own design doc and careful implementation. See:
`plans/structural-send-input.md` (to be created).

## What Lives Where

**This is a tentickle architecture, not an agentick feature.**

Agentick has no opinions about how apps structure their sessions. Other
apps might use single-session, flat multi-session, or completely different
patterns. The kernel/shell/worker model is tentickle's choice.

```
tentickle/
├── packages/
│   ├── kernel/           # Dispatch loop, event routing (~80 lines)
│   ├── shell/            # Shell agent component + delegation tools
│   ├── worker/           # Worker agent configs (coding, research, etc.)
│   └── tools/            # Glob, Grep (worker-level tools)
```

Or maybe kernel is just a file, not a package. It's that small.

## TypeScript / JSX Compatibility

The kernel/process metaphor is a conceptual architecture, not a deployment
model. Sessions in agentick already provide the right isolation:

- Separate component trees (separate reconciler cycles)
- Separate context windows (separate model calls)
- Separate timelines (separate message histories)
- Separate tool sets (sandbox scoping)

They share a V8 heap — that's an optimization, not a compromise. The session
boundary IS the process boundary. If crash isolation is needed later, worker
sessions move to child processes communicating via the gateway transport.
Architecture doesn't change — only the wire.

The JSX story is what MAKES this work. Each session is a component tree.
The kernel renders a reactive event loop. Shells render `<ShellAgent>`.
Workers render `<CodingAgent>`. Composition is just React.

## Open Questions

1. **Does the kernel need a model?** Current sketch says no — pure dispatch.
   But trigger evaluation ("should this cron fire?") might benefit from
   lightweight model calls. Could use `@agentick/apple` (local, free) for
   this without changing the architecture.

2. **Shell context gathering.** Shell needs to understand requests well
   enough to frame good delegations. Does it: (a) delegate blind, (b) do
   inline queries first, or (c) rely on memory context? Probably all three
   depending on the situation.

3. **Worker types.** Not all workers are coding agents. Quick inline queries
   need lightweight workers (fast, disposable). Heavy refactoring needs
   full coding workers (sandbox, verification gates). Different component
   trees, different tool sets, different configs.

4. **Trigger routing.** When a cron fires, where does the result go? All
   shells? A default shell? Configurable per trigger? The kernel's
   "scheduling policy" for unsolicited events.

5. **Session graph queries in agentick.** Partially exist — `_parent` and
   `_children` are private fields on SessionImpl. Need public API. Legitimate
   framework primitive. Not kernel-specific.

6. **Structural SendInput design (BLOCKING).** The mechanism for injecting
   grounding, system, sections, ephemeral into sessions programmatically.
   This is the agentick-side enabler for the kernel's pipe mechanism. Needs
   its own design doc. Key decisions:
   - Override vs merge semantics between JSX and SendInput fields
   - COM state lifecycle (COM clears each tick — how do SendInput entries
     persist across ticks? Or are they re-injected each compile?)
   - Timeline/messages interaction with `<Timeline>` component
   - TTL semantics on ephemeral entries

7. **Collapsible tool results.** TTL-based decay for tool output in shell
   context. Tool render function receives `tickAge`, returns full content
   or summary. Framework primitive (generalizes `<Ephemeral>`) or tool-level
   concern? Probably tool-level — render function already exists.

## Relationship to Existing Work

- **Delegation system (tentickle):** The kernel replaces the 9-tool delegation
  system with ~3 graph operations. The delegation-irks doc identified this:
  "session graph as first class" dissolves 7/10 irks.

- **Artifacts plan (agentick):** Artifacts are NOT a framework primitive.
  They're a library using the Provider pattern. The pipe mechanism should
  compose from session results + structural SendInput + channels.

- **Connectors (agentick):** Connectors create shell sessions, one per
  conversation. The connector itself is infra — the shell is the session.

- **TentickleMemory:** Cross-session memory is the glue. Any shell can
  query. Completions, errors, progress — all recorded as facts retrievable
  by any future shell.

- **Event-role messages:** Worker progress/completion arrives as `role: "event"`
  in the originating shell's timeline. System triggers (cron, heartbeat)
  also arrive as events. The shell's timeline IS the running log.

## Next Steps

### 1. Structural SendInput (agentick — framework change)

The blocking enabler. Extend `SendInput` to accept structural primitives
(grounding, system, sections, ephemeral) alongside messages. This is
general-purpose — not kernel-specific. Any app that programmatically
composes sessions benefits.

Design doc needed: `agentick/plans/structural-send-input.md`

Key work:

- SendInput type extension in `@agentick/shared`
- COM state injection at compile time in session/engine
- Override/merge semantics between JSX and SendInput
- Tests for all structural types
- Verify no breaking changes to existing send/spawn consumers

### 2. Session graph public API (agentick — small framework change)

Expose `parent` and `children` as public read-only properties on Session.
Currently private (`_parent`, `_children`). Tiny change, legitimate primitive.

### 3. Kernel implementation (tentickle)

Once structural SendInput exists:

- Kernel dispatch loop (~80 lines)
- Shell agent component + 5 delegation tools
- Worker provisioning (coding, query, research configs)
- Event routing and process table queries
- Integration with TentickleMemory for durable records
- Integration with connectors as shell session factories
