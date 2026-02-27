# Artifacts

Workers produce outputs: code files, analysis documents, schemas, plans. Without artifacts, the only signal back to the kernel is a truncated text response. The kernel can't know _what_ was produced, can't query outputs by name or type, and can't pipe one worker's outputs into another worker's context.

Artifacts make worker outputs explicit, named, typed, and queryable.

## How It Works

Three tools give the model artifact management:

| Tool             | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `store_artifact` | Declare a named output                   |
| `get_artifact`   | Retrieve an artifact by ID or name       |
| `list_artifacts` | List available artifacts, filter by type |

The model decides when to store artifacts. When a delegated worker completes, the kernel queries artifacts for that session and includes a summary in the completion notification — so the orchestrator knows exactly what was produced.

```
[Worker Complete] "analyze auth flow"

Result: JWT with rotating refresh tokens...

Artifacts:
- auth-analysis (analysis): Auth strategy overview
- token-schema (schema): Token rotation schema
```

## Session Scoping

Every artifact is tagged with the session ID of the worker that created it. This happens automatically — `store_artifact`'s handler reads `ctx.sessionId` from the COM (Context Object Model).

When the kernel queries `store.list(sessionId)`, it gets only that worker's outputs. No cross-contamination between concurrent workers.

## Storage

All artifacts live in the agent's SQLite database (`~/.tentickle/data/tentickle.db`):

| Table       | Purpose                                         |
| ----------- | ----------------------------------------------- |
| `artifacts` | Name, type, content, summary, metadata, session |

No FTS, no embeddings. Artifacts are queried relationally — by session ID, name, or type. If content search is needed later, FTS can be added in a follow-up migration.

## Architecture

Artifacts are a tentickle library, not a framework feature. Same pattern as [memory](/docs/memory):

- `ArtifactStore` class — SQLite CRUD, sync operations
- `createStoreArtifactTool` / `createGetArtifactTool` / `createListArtifactsTool` — standard `createTool` wrappers
- `bindArtifactStore()` / `getArtifactStore()` — global binding
- `ensureArtifactSchema()` — versioned migration runner

No framework code was modified to add artifacts (except `COM.sessionId` — tool handlers needed to know their session, which was a missing primitive). This is [the bright line](https://agenticklabs.github.io/agentick/docs/architecture) in practice.
