# Cross-Session Memory

The agent has persistent memory backed by SQLite. It remembers facts across sessions and retrieves them using keyword search and semantic similarity — no exact phrasing required.

## How It Works

Two tools give the model memory:

| Tool       | Purpose                              |
| ---------- | ------------------------------------ |
| `remember` | Store a fact, preference, or insight |
| `recall`   | Search memory using natural language |

The model decides when to remember and when to recall. No prompting from the user required.

## Retrieval

Recall uses hybrid search — two retrieval methods fused together:

1. **FTS5 keyword search** — exact token matching via SQLite's full-text index. Fast, precise when the query shares words with the stored memory.
2. **Vector similarity** — semantic matching via cosine distance on embeddings. Finds related concepts even without shared keywords.

Results are merged using [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) (RRF), which combines rankings from both sources into a single scored list. Memories that appear in both FTS and vector results get a rank boost.

```
"language preference" → finds "Ryan prefers TypeScript over Python"
```

FTS alone would miss this — no shared keywords. Semantic search catches the relationship between "language preference" and "prefers TypeScript."

## Embedding

Vector embeddings are generated locally using [transformers.js](https://huggingface.co/docs/transformers.js) with the `Xenova/all-MiniLM-L6-v2` model (384 dimensions, ~33MB). No API calls, no network dependency.

The embedding pipeline is lazy — the model downloads on first use and subsequent loads are instant from cache (`~/.cache/huggingface/hub/`).

Embeddings are fire-and-forget: `remember` returns immediately while the vector is computed asynchronously. If the embedding model isn't available, the system degrades gracefully to FTS-only search.

## Storage

All memory lives in the agent's SQLite database (`~/.tentickle/data/tentickle.db`):

| Table          | Purpose                                    |
| -------------- | ------------------------------------------ |
| `memories`     | Content, topic, importance, timestamps     |
| `memories_fts` | FTS5 virtual table for keyword search      |
| `memory_vec`   | sqlite-vec virtual table for vector search |

Memory persists across sessions, restarts, and agent upgrades. The database is the source of truth — no external services involved.

## Architecture

Memory is a tentickle library, not a framework feature. It composes with agentick primitives:

- `TentickleMemory` class — SQLite operations, FTS5, sqlite-vec, RRF fusion
- `createRememberTool` / `createRecallTool` — standard `createTool` wrappers
- `bindMemory()` / `getMemory()` — global binding pattern (same as session store)
- `huggingfaceEmbedding()` from `@agentick/huggingface` — embedding adapter

No framework code was modified to add memory. This is [the bright line](https://agenticklabs.github.io/agentick/docs/architecture) in practice.
