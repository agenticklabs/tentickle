import type { App, AppOptions, ComponentFunction } from "@agentick/core";
import type { EmbeddingModel } from "@agentick/core/model";
import type { StreamEvent, EntryCommittedEvent } from "@agentick/shared";
import { createApp } from "@agentick/core";
import { huggingfaceEmbedding } from "@agentick/huggingface";
import { openDatabase, ensureStorageSchema, TentickleSessionStore } from "@tentickle/storage";
import { ensureMemorySchema, TentickleMemory } from "@tentickle/memory";
import { getDbPath } from "./paths.js";

export interface TentickleAppOptions extends AppOptions {
  /** Embedding model for semantic memory search. Default: huggingfaceEmbedding(). Pass false to disable. */
  embedding?: EmbeddingModel | false;
}

export interface TentickleAppResult<P> {
  app: App<P>;
  store: TentickleSessionStore;
  memory: TentickleMemory;
}

function wireStorePersistence(store: TentickleSessionStore, event: StreamEvent): void {
  switch (event.type) {
    case "execution_start": {
      const sessionId = event.sessionId ?? event.executionId;
      store.createExecution(event.executionId, sessionId, "send");
      break;
    }
    case "tick_start": {
      if (event.executionId) {
        store.recordTickStart(event.executionId, event.tick);
      }
      break;
    }
    case "entry_committed": {
      const e = event as EntryCommittedEvent;
      if (event.sessionId) {
        store.commitEntry(
          event.sessionId,
          e.entry as any,
          e.executionId,
          event.tick,
          e.timelineIndex,
        );
      }
      break;
    }
    case "tick_end": {
      if (event.executionId) {
        store.recordTickEnd(
          event.executionId,
          event.tick,
          event.model,
          event.usage,
          typeof event.stopReason === "string" ? event.stopReason : undefined,
        );
      }
      break;
    }
    case "execution_end": {
      const status = event.error ? "failed" : event.aborted ? "aborted" : "completed";
      store.completeExecution(event.executionId, status, event.tick, event.error?.message);
      break;
    }
  }
}

export async function createTentickleApp<P extends Record<string, unknown>>(
  Agent: ComponentFunction<P>,
  options: TentickleAppOptions = {},
): Promise<TentickleAppResult<P>> {
  const db = await openDatabase(getDbPath(), { allowExtension: true });
  ensureStorageSchema(db);
  ensureMemorySchema(db);
  const store = new TentickleSessionStore(db);
  const memory = TentickleMemory.create(db);

  // Enable semantic search unless explicitly disabled
  if (options.embedding !== false) {
    const model = options.embedding ?? huggingfaceEmbedding();
    memory.initVec({
      embed: model.embed.bind(model),
      dimensions: model.metadata.dimensions,
    });
  }

  const app = createApp<P>(Agent, {
    ...options,
    sessions: { ...options.sessions, store },
    onEvent: (event) => {
      try {
        wireStorePersistence(store, event);
      } catch {
        // don't crash session on persistence failures
      }
      options.onEvent?.(event);
    },
  });

  return { app, store, memory };
}
