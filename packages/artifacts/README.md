# @tentickle/artifacts

Named, typed, queryable worker outputs. Artifacts make worker outputs explicit — the kernel knows what was produced, can query by name or type, and can pipe one worker's outputs into another worker's context.

## What Artifacts Are

An artifact is a named, typed output declared by a worker during execution. Not the file on disk — the declaration that "I produced this, here's its content and metadata."

- **Named** — human-readable identifier (`"auth-analysis"`, `"migration-plan"`)
- **Typed** — category (`code`, `document`, `analysis`, `schema`, `plan`)
- **Content-bearing** — the actual output content
- **Session-scoped** — tracks which worker created it
- **Queryable** — by session, name, type

Artifacts are not a file system (files live on disk via sandbox tools), not memory (memory is semantic/fuzzy — artifacts are concrete named outputs), and not a framework feature (built entirely from `createTool`, SQLite, and global binding).

## Tools

Three tools are wired into every `<TentickleAgent>`:

| Tool             | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `store_artifact` | Declare a named output                   |
| `get_artifact`   | Retrieve an artifact by ID or name       |
| `list_artifacts` | List available artifacts, filter by type |

Workers call `store_artifact` to register outputs. The kernel queries `list(sessionId)` when a worker completes to include an artifact summary in the completion notification — so the orchestrator knows exactly what was produced without parsing free-text responses.

## Store

`ArtifactStore` is a thin class over SQLite. All operations are synchronous (no embeddings, no async).

```typescript
import { ArtifactStore } from "@tentickle/artifacts";

const store = ArtifactStore.create(db);

// Store
const entry = store.store({
  name: "auth-analysis",
  type: "analysis",
  content: "JWT with rotating refresh tokens...",
  summary: "Auth strategy overview",
});

// Retrieve
store.get(entry.id); // by UUID
store.getByName("auth-analysis"); // most recent match
store.getByName("auth-analysis", sessionId); // scoped to session

// Query
store.list(); // all, newest first
store.list(sessionId); // scoped to session
store.listByType("code"); // filtered by type
store.listByType("code", sessionId); // both filters

// Update & delete
store.update(entry.id, { content: "revised..." });
store.delete(entry.id);
```

## Schema

Single table, no FTS. Artifacts are queried relationally — by session, name, or type.

```sql
CREATE TABLE artifacts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text',
  content    TEXT NOT NULL,
  summary    TEXT,
  metadata   TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Indexes on `session_id`, `name`, `type`. Schema managed via `ensureArtifactSchema(db)` with versioned migrations (same pattern as `@tentickle/memory` and `@tentickle/storage`).

## Integration

### App factory

`createTentickleApp` creates the store, binds it globally, and returns it:

```typescript
const { app, store, memory, artifacts } = await createTentickleApp(Agent);
```

### Agent component

`<TentickleAgent>` wires `store_artifact`, `get_artifact`, and `list_artifacts` into the component tree automatically. Pass `artifacts` as a prop or let it resolve from the global binding.

### Kernel completion

When a delegated worker completes, the kernel queries `artifactStore.list(sessionId)` and appends an artifact summary to the completion notification:

```
[Worker Complete] "analyze auth flow"

Result: JWT with rotating refresh tokens...

Artifacts:
- auth-analysis (analysis): Auth strategy overview
- token-schema (schema): Token rotation schema
```

The orchestrator sees exactly what was produced — not just truncated text.

## Global Binding

Same pattern as memory and session store:

```typescript
import { bindArtifactStore, getArtifactStore } from "@tentickle/artifacts";

bindArtifactStore(store); // set
getArtifactStore(); // get (or null)
```

## Architecture

This is a tentickle library, not a framework primitive. Everything composes with existing agentick primitives:

- `ArtifactStore` — SQLite CRUD, sync operations
- `createStoreArtifactTool` / `createGetArtifactTool` / `createListArtifactsTool` — standard `createTool` wrappers
- `bindArtifactStore()` / `getArtifactStore()` — global binding
- `ensureArtifactSchema()` — versioned migration runner

No framework code was modified to add artifacts (except `COM.sessionId` which was a missing primitive — tool handlers need to know their session).
